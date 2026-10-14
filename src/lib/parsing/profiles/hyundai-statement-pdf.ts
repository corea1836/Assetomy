import { daysInMonth } from "@/lib/analytics/dates";
import type {
  ParseFailure,
  ParseResult,
  ParsedTransaction,
  PdfRow,
  UnreadableReason,
} from "@/types/parsing";
import type { IsoDate } from "@/types/transaction";
import { contentEventKeys, normalizeMerchantKey, parseWonAmount } from "../normalize";

export const MAX_TRANSACTIONS = 5000;

const HEADER = /^\d{1,2}월 \d{1,2}일 명세서$/;
const WON_AMOUNT = /^(-?\d{1,3}(?:,\d{3})*)원$/;
const DATE_ROW = /^(\d{2})\. (\d{1,2})\. (\d{1,2}) \([월화수목금토일]\)$/;
const CURRENCY_ROW = /^\([A-Z]{3}\s*:\s*[\d,.]+\)$/;
// 20자에서 잘린 가맹점명의 남은 부분 + ",통화:금액"(예: "SU,USD:22.00")
const CURRENCY_TAIL_ROW = /^(.*?)\s*,\s*[A-Z]{3}\s*:\s*[\d,.]+$/;
// 취소된 거래의 적립 줄 아래에 붙는 줄
const PAYMENT_CANCEL = "결제 취소";

function isHeader(row: PdfRow): boolean {
  return row.page === 1 && HEADER.test(row.text);
}

function unreadable(reason: UnreadableReason): ParseFailure {
  return { ok: false, code: "UNREADABLE", reason };
}

function readTransaction(row: PdfRow): { merchant: string; amount: number } | null {
  const lastCell = row.cells.at(-1)?.str.trim();
  let amount: number | null;
  let merchantCells: PdfRow["cells"];

  // 결합한 text에서는 가맹점명 끝 숫자와 금액을 구분할 수 없어 셀 경계로 읽는다.
  if (lastCell === "원") {
    amount = parseWonAmount(row.cells.at(-2)?.str ?? "");
    merchantCells = row.cells.slice(0, -2);
  } else {
    const match = lastCell?.match(WON_AMOUNT);
    if (!match) return null;
    amount = parseWonAmount(match[1]);
    merchantCells = row.cells.slice(0, -1);
  }
  if (amount === null) return null;

  const merchant = merchantCells.map((cell) => cell.str).join("")
    .replace(/\s+/g, " ").trim()
    .replace(/\s*\([A-Z]{3}\s*:\s*[\d,.]+\)$/, "")
    .replace(/\s*,\s*[A-Z]{3}\s*:\s*[\d,.]+$/, "")
    .replace(/\s+\d+건$/, "")
    .trim();
  return { merchant, amount };
}

export function detectHyundaiStatement(rows: PdfRow[]): boolean {
  return rows.some(isHeader) && rows.some((row) => row.text.includes("현대카드"));
}

export function parseHyundaiStatement(rows: PdfRow[]): ParseResult {
  const headerIndex = rows.findIndex(isHeader);
  if (headerIndex === -1) {
    return { ok: false, code: "UNSUPPORTED_FILE", reason: "unknown_format" };
  }

  const totalMatch = rows[headerIndex + 1]?.text.match(WON_AMOUNT);
  if (!totalMatch) return unreadable("broken_layout");
  const statementTotal = parseWonAmount(totalMatch[1]);
  if (statementTotal === null) return unreadable("broken_layout");

  let currentDate: IsoDate | undefined;
  // 같은 날짜 아래 바로 앞 거래. "결제 취소" 줄은 이 거래의 취소다.
  let previousMerchant: string | null = null;
  const transactions: Omit<ParsedTransaction, "sourceEventKey">[] = [];
  for (let index = headerIndex + 2; index < rows.length; index += 1) {
    const row = rows[index];
    const dateMatch = row.text.match(DATE_ROW);
    if (dateMatch) {
      const [, year, month, day] = dateMatch;
      const monthNumber = Number(month);
      const dayNumber = Number(day);
      const yearMonth = `20${year}-${month.padStart(2, "0")}`;
      if (
        monthNumber < 1 || monthNumber > 12 ||
        dayNumber < 1 || dayNumber > daysInMonth(yearMonth)
      ) {
        return unreadable("broken_layout");
      }
      currentDate = `${yearMonth}-${day.padStart(2, "0")}`;
      previousMerchant = null;
      continue;
    }

    const transaction = readTransaction(row);
    if (!transaction) continue;
    const { amount } = transaction;
    let { merchant } = transaction;
    if (merchant === PAYMENT_CANCEL) {
      if (amount > 0) return unreadable("cancel_label");
      if (!previousMerchant || !currentDate) return unreadable("broken_layout");
      if (amount !== 0) {
        transactions.push({
          date: currentDate,
          merchant: previousMerchant,
          merchantKey: normalizeMerchantKey(previousMerchant),
          amount,
          eventKind: "cancel",
        });
      }
      continue;
    }
    if (!merchant || !currentDate) return unreadable("broken_layout");

    let paymentIndex = index + 1;
    for (; paymentIndex < rows.length; paymentIndex += 1) {
      const text = rows[paymentIndex].text;
      if (CURRENCY_ROW.test(text)) continue;
      const tail = text.match(CURRENCY_TAIL_ROW);
      if (!tail) break;
      merchant = `${merchant} ${tail[1]}`.replace(/\s+/g, " ").trim();
    }
    const payment = rows[paymentIndex];
    if (!payment || !payment.text.includes("현대카드")) return unreadable("broken_layout");
    if (!payment.text.startsWith("일시불 ")) return unreadable("not_lump_sum");
    if (amount > 0 && (row.text.includes("취소") || payment.text.includes("취소"))) {
      return unreadable("cancel_label");
    }

    if (amount !== 0) {
      transactions.push({
        date: currentDate,
        merchant,
        merchantKey: normalizeMerchantKey(merchant),
        amount,
        eventKind: amount < 0 ? "cancel" : "purchase",
      });
    }
    previousMerchant = merchant;
    index = paymentIndex;
  }

  if (transactions.length === 0) return unreadable("no_transactions");
  if (transactions.length > MAX_TRANSACTIONS) return unreadable("too_many_rows");

  // 중간 합계가 안전한 정수 범위를 넘더라도 대조하는 합계는 정확하게 유지한다.
  const total = transactions.reduce(
    (sum, transaction) => sum + BigInt(transaction.amount), BigInt(0),
  );
  if (total !== BigInt(statementTotal)) return unreadable("total_mismatch");

  const eventKeys = contentEventKeys(transactions);
  return {
    ok: true,
    profile: "hyundai_statement_pdf",
    identityScope: "content",
    cancelStyle: "negative_amount",
    statementTotal,
    transactions: transactions.map((transaction, index) => ({
      ...transaction,
      sourceEventKey: eventKeys[index],
    })),
  };
}
