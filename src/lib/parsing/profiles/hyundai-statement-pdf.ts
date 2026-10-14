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

const HEADER = /^(\d{1,2})월 (\d{1,2})일 명세서$/;
const WON_AMOUNT = /^(-?\d{1,3}(?:,\d{3})*)원$/;
const DATE_ROW = /^(\d{2})\. (\d{1,2})\. (\d{1,2}) \([월화수목금토일]\)$/;
const CURRENCY_ROW = /^\([A-Z]{3}\s*:\s*[\d,.]+\)$/;
// 명세서는 가맹점명을 20자에서 자르고, 화면 폭을 넘으면 나머지를 다음 줄로 넘긴다.
const MERCHANT_MAX_LENGTH = 20;
// 넘어간 가맹점명 나머지 + ",통화:금액"(예: "SU,USD:22.00")
const CURRENCY_TAIL_ROW = /^(.*?)\s*,\s*[A-Z]{3}\s*:\s*[\d,.]+$/;
const REWARD_ROW = /\(\d+(?:\.\d+)?%\)$/;
// 취소된 거래의 적립 줄 아래에 붙는 줄
const PAYMENT_CANCEL = "결제 취소";
// 연회비 줄에는 결제 방식 없이 카드 이름만 있는 줄이 붙는다(할부가 아니다)
const ANNUAL_FEE = "연회비";

function isHeader(row: PdfRow): boolean {
  return row.page === 1 && HEADER.test(row.text);
}

function unreadable(reason: UnreadableReason): ParseFailure {
  return { ok: false, code: "UNREADABLE", reason };
}

export function statementDate(month: number, day: number, lastDate: IsoDate): IsoDate | null {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) {
    return null;
  }

  const monthDay = String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  const lastMonthDay = lastDate.slice(5);
  const year = Number(lastDate.slice(0, 4)) + (monthDay < lastMonthDay ? 1 : 0);
  const yearMonth = String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0");
  if (day > daysInMonth(yearMonth)) return null;
  return yearMonth + "-" + String(day).padStart(2, "0");
}

function readProductName(row: PdfRow): string | null {
  const lastCell = row.cells.at(-1)?.str.trim();
  let productCells = row.cells;
  if (lastCell === "원") productCells = row.cells.slice(0, -2);
  else if (/^-?[\d,]+원$/.test(lastCell ?? "")) productCells = row.cells.slice(0, -1);

  const product = productCells.map((cell) => cell.str).join("")
    .replace(/\s+/g, " ").trim().replace(/^일시불\s+/, "");
  return product.startsWith("현대카드") && Array.from(product).length <= 40 ? product : null;
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

// 줄이 넘어간 곳이 공백이었으면 공백을 넣어도 20자 안이다.
function joinMerchantTail(head: string, tail: string): string {
  const rest = tail.replace(/\s+/g, " ").trim();
  if (!rest) return head;
  const spaced = `${head} ${rest}`;
  return Array.from(spaced).length <= MERCHANT_MAX_LENGTH ? spaced : `${head}${rest}`;
}

// 거래 줄 바로 다음의 짧은 글자 줄은 넘어간 가맹점명 나머지다.
function isMerchantTail(head: string, row: PdfRow): boolean {
  return !DATE_ROW.test(row.text) && !row.text.includes("현대카드") && !REWARD_ROW.test(row.text)
    && readTransaction(row) === null
    && Array.from(`${head}${row.text.trim()}`).length <= MERCHANT_MAX_LENGTH;
}

export function detectHyundaiStatement(rows: PdfRow[]): boolean {
  return rows.some(isHeader) && rows.some((row) => row.text.includes("현대카드"));
}

export function parseHyundaiStatement(rows: PdfRow[], savedAt: string | null = null): ParseResult {
  const headerIndex = rows.findIndex(isHeader);
  if (headerIndex === -1) {
    return { ok: false, code: "UNSUPPORTED_FILE", reason: "unknown_format" };
  }

  const totalMatch = rows[headerIndex + 1]?.text.match(WON_AMOUNT);
  if (!totalMatch) return unreadable("broken_layout");
  const statementTotal = parseWonAmount(totalMatch[1]);
  if (statementTotal === null) return unreadable("broken_layout");
  const headerMatch = rows[headerIndex].text.match(HEADER);
  if (!headerMatch) return unreadable("broken_layout");
  const statementMonth = Number(headerMatch[1]);
  const statementDay = Number(headerMatch[2]);

  let currentDate: IsoDate | undefined;
  // 같은 날짜 아래 바로 앞 거래. "결제 취소" 줄은 이 거래의 취소다.
  let previousMerchant: string | null = null;
  const transactions: Omit<ParsedTransaction, "sourceEventKey">[] = [];
  const productNames = new Set<string>();
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
      const next = rows[paymentIndex];
      if (CURRENCY_ROW.test(next.text)) continue;
      const currencyTail = next.text.match(CURRENCY_TAIL_ROW);
      if (currencyTail) merchant = joinMerchantTail(merchant, currencyTail[1]);
      else if (paymentIndex === index + 1 && isMerchantTail(merchant, next)) merchant = joinMerchantTail(merchant, next.text);
      else break;
    }
    const payment = rows[paymentIndex];
    if (!payment || !payment.text.includes("현대카드")) return unreadable("broken_layout");
    const annualFee = merchant === ANNUAL_FEE && payment.text.startsWith("현대카드");
    if (!payment.text.startsWith("일시불 ") && !annualFee) return unreadable("not_lump_sum");
    if (amount > 0 && (row.text.includes("취소") || payment.text.includes("취소"))) {
      return unreadable("cancel_label");
    }
    const productName = readProductName(payment);
    if (!productName) return unreadable("broken_layout");
    productNames.add(productName);

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
  if (productNames.size > 1) return unreadable("multiple_cards");
  if (productNames.size === 0) return unreadable("broken_layout");

  // 중간 합계가 안전한 정수 범위를 넘더라도 대조하는 합계는 정확하게 유지한다.
  const total = transactions.reduce(
    (sum, transaction) => sum + BigInt(transaction.amount), BigInt(0),
  );
  if (total !== BigInt(statementTotal)) return unreadable("total_mismatch");

  const lastDate = transactions.reduce<IsoDate>(
    (last, transaction) => transaction.date > last ? transaction.date : last,
    transactions[0].date,
  );
  const billingDate = statementDate(statementMonth, statementDay, lastDate);
  if (!billingDate) return unreadable("broken_layout");

  const eventKeys = contentEventKeys(transactions);
  return {
    ok: true,
    profile: "hyundai_statement_pdf",
    issuer: "hyundai",
    identityScope: "content",
    cancelStyle: "negative_amount",
    statementTotal,
    statement: { date: billingDate, productName: productNames.values().next().value!, savedAt },
    transactions: transactions.map((transaction, index) => ({
      ...transaction,
      sourceEventKey: eventKeys[index],
    })),
  };
}
