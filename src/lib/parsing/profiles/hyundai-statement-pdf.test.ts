import { describe, expect, it } from "vitest";
import type { PdfRow, PdfTextItem } from "@/types/parsing";
import fixture from "../__fixtures__/hyundai-statement-pdf.items.json";
import { groupPdfRows } from "../pdf-rows";
import {
  detectHyundaiStatement,
  MAX_TRANSACTIONS,
  parseHyundaiStatement,
} from "./hyundai-statement-pdf";

const fixtureItems: PdfTextItem[] = fixture;
type FixtureEdit = Pick<PdfTextItem, "page" | "y" | "str"> & {
  replacement: string | null;
};

function editedFixtureRows(edits: FixtureEdit[]): PdfRow[] {
  const items = fixtureItems.map((item) => ({ ...item }));
  for (const { page, y, str, replacement } of edits) {
    const index = items.findIndex(
      (item) => item.page === page && item.y === y && item.str === str,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    if (replacement === null) items.splice(index, 1);
    else items[index].str = replacement;
  }
  return groupPdfRows(items);
}

function row(strings: string[], page = 1): PdfRow {
  return {
    page,
    y: 0,
    cells: strings.map((str, x) => ({ x, str })),
    text: strings.join("").replace(/\s+/g, " ").trim(),
  };
}

function statementRows(total: string, ...body: string[][]): PdfRow[] {
  return [
    row(["10월 23일 명세서"]),
    row([`${total}원`]),
    row(["26. 10. 11 (일)"]),
    ...body.map((strings) => row(strings)),
  ];
}

function parseSuccess(rows: PdfRow[]) {
  const result = parseHyundaiStatement(rows);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected a successfully parsed statement");
  return result;
}

describe("detectHyundaiStatement", () => {
  it("recognizes the anonymized fixture", () => {
    expect(detectHyundaiStatement(groupPdfRows(fixtureItems))).toBe(true);
  });

  it("accepts the Hyundai marker on another page", () => {
    expect(detectHyundaiStatement([
      row(["1월 2일 명세서"]),
      row(["현대카드"], 2),
    ])).toBe(true);
  });

  it("requires the statement header on the first page", () => {
    const rows = [row(["현대카드"]), row(["10월 23일 명세서"], 2)];
    expect(detectHyundaiStatement(rows)).toBe(false);
    expect(parseHyundaiStatement(rows)).toEqual({
      ok: false, code: "UNSUPPORTED_FILE", reason: "unknown_format",
    });
  });

  it("requires a Hyundai marker somewhere in the rows", () => {
    expect(detectHyundaiStatement([row(["10월 23일 명세서"])]))
      .toBe(false);
  });

  it("rejects a header with its statement fragment removed", () => {
    const rows = editedFixtureRows([
      { page: 1, y: 680.2, str: "명세서", replacement: null },
    ]);
    expect(detectHyundaiStatement(rows)).toBe(false);
    expect(parseHyundaiStatement(rows)).toEqual({
      ok: false, code: "UNSUPPORTED_FILE", reason: "unknown_format",
    });
  });

  it("rejects an empty input", () => {
    expect(detectHyundaiStatement([])).toBe(false);
    expect(parseHyundaiStatement([])).toEqual({
      ok: false, code: "UNSUPPORTED_FILE", reason: "unknown_format",
    });
  });
});

describe("parseHyundaiStatement with the anonymized fixture", () => {
  it("matches the exact statement and monthly totals, count and date range", () => {
    const result = parseSuccess(groupPdfRows(fixtureItems));

    expect(result).toMatchObject({
      ok: true,
      profile: "hyundai_statement_pdf",
      identityScope: "content",
      cancelStyle: "negative_amount",
      statementTotal: 1_820_075,
    });
    expect(result.transactions).toHaveLength(78);
    expect(result.transactions.every((transaction) => transaction.eventKind === "purchase"))
      .toBe(true);
    const total = (month: string) => result.transactions
      .filter((transaction) => transaction.date.startsWith(month))
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    expect(total("")).toBe(1_820_075);
    expect(total("2026-09")).toBe(804_201);
    expect(total("2026-10")).toBe(1_015_874);
    const dates = result.transactions.map((transaction) => transaction.date).sort();
    expect(dates[0]).toBe("2026-09-12");
    expect(dates[dates.length - 1]).toBe("2026-10-11");
  });

  it("preserves file order and derives content keys from normalized merchants", () => {
    const { transactions } = parseSuccess(groupPdfRows(fixtureItems));

    expect(transactions[0]).toEqual({
      date: "2026-10-11",
      merchant: "한빛주유소",
      merchantKey: "한빛주유소",
      amount: 50_000,
      eventKind: "purchase",
      sourceEventKey: "2026-10-11|한빛주유소|50000|0",
    });
    expect(transactions[transactions.length - 1]).toEqual({
      date: "2026-09-12",
      merchant: "오늘마트24R햇살점",
      merchantKey: "오늘마트24R햇살점",
      amount: 6_500,
      eventKind: "purchase",
      sourceEventKey: "2026-09-12|오늘마트24R햇살점|6500|0",
    });
    expect(transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: "2026-10-06", merchant: "SKYAPI", amount: 15_073 }),
      expect.objectContaining({ date: "2026-10-06", merchant: "ACME* CLOUD SUB", amount: 30_131 }),
      expect.objectContaining({ date: "2026-10-08", merchant: "민자도로후불교통카드", amount: 10_000 }),
      expect.objectContaining({ date: "2026-09-19", merchant: "(주)결제대행 - (주)달빛떡집", amount: 40_000 }),
      expect.objectContaining({ date: "2026-09-15", merchant: "택시-가람 00 가 0000", amount: 6_400 }),
    ]));
    const keys = transactions.map((transaction) => transaction.sourceEventKey);
    expect(new Set(keys).size).toBe(78);
    expect(keys).toEqual(expect.arrayContaining([
      "2026-09-18|오늘마트24R햇살점|2000|0",
      "2026-09-18|오늘마트24R햇살점|2000|1",
      "2026-09-18|오늘마트24R햇살점|2000|2",
    ]));
  });

  it("rejects a one-won statement total mismatch without correcting it", () => {
    expect(parseHyundaiStatement(editedFixtureRows([
      { page: 1, y: 648.2, str: "1,820,075", replacement: "1,820,076" },
    ]))).toEqual({ ok: false, code: "UNREADABLE", reason: "total_mismatch" });
  });

  it("rejects installment payments before checking the total", () => {
    expect(parseHyundaiStatement(editedFixtureRows([
      { page: 1, y: 448.9, str: "일시불", replacement: "할부(3개월)" },
      { page: 1, y: 648.2, str: "1,820,075", replacement: "1,820,076" },
    ]))).toEqual({ ok: false, code: "UNREADABLE", reason: "not_lump_sum" });
  });

  it("reads a negative amount as a cancellation with a signed content key", () => {
    const result = parseSuccess(editedFixtureRows([
      { page: 11, y: 293.7, str: "6,500", replacement: "-6,500" },
      { page: 1, y: 648.2, str: "1,820,075", replacement: "1,807,075" },
    ]));
    expect(result.statementTotal).toBe(1_807_075);
    expect(result.transactions).toHaveLength(78);
    expect(result.transactions[result.transactions.length - 1]).toMatchObject({
      date: "2026-09-12",
      merchant: "오늘마트24R햇살점",
      amount: -6_500,
      eventKind: "cancel",
      sourceEventKey: "2026-09-12|오늘마트24R햇살점|-6500|0",
    });
  });

  it("rejects a cancellation label on a positive transaction", () => {
    expect(parseHyundaiStatement(editedFixtureRows([
      { page: 1, y: 469.8, str: "한빛주유소", replacement: "한빛주유소 취소" },
    ]))).toEqual({ ok: false, code: "UNREADABLE", reason: "cancel_label" });
  });

  it("rejects a cancellation label in the payment method of a positive transaction", () => {
    expect(parseHyundaiStatement(editedFixtureRows([
      { page: 1, y: 448.9, str: "MM", replacement: "MM 취소" },
    ]))).toEqual({ ok: false, code: "UNREADABLE", reason: "cancel_label" });
  });

  it("rejects a first transaction with no preceding date", () => {
    expect(parseHyundaiStatement(editedFixtureRows([
      { page: 1, y: 511.4, str: "26. 10. 11 (", replacement: null },
      { page: 1, y: 511.4, str: "일", replacement: null },
      { page: 1, y: 511.4, str: ")", replacement: null },
    ]))).toEqual({ ok: false, code: "UNREADABLE", reason: "broken_layout" });
  });

  it("rejects a missing payment method without skipping intervening rows", () => {
    expect(parseHyundaiStatement(editedFixtureRows([
      { page: 1, y: 448.9, str: "일시불", replacement: null },
      { page: 1, y: 448.9, str: " ", replacement: null },
      { page: 1, y: 448.9, str: "현대카드", replacement: null },
      { page: 1, y: 448.9, str: "MM", replacement: null },
    ]))).toEqual({ ok: false, code: "UNREADABLE", reason: "broken_layout" });
  });

  it.each(["26. 0. 11 (", "26. 13. 11 (", "26. 2. 30 (", "26. 10. 0 ("])
    ("rejects an invalid calendar date %s", (prefix) => {
      expect(parseHyundaiStatement(editedFixtureRows([
        { page: 1, y: 511.4, str: "26. 10. 11 (", replacement: prefix },
        { page: 1, y: 511.4, str: "일", replacement: "월" },
      ]))).toEqual({ ok: false, code: "UNREADABLE", reason: "broken_layout" });
    });

  it("leaves the fixture, rows and cells unchanged across repeated parsing", () => {
    const originalItems = fixtureItems.map((item) => ({ ...item }));
    const rows = groupPdfRows(fixtureItems);
    const originalRows = structuredClone(rows);
    for (const pdfRow of rows) {
      pdfRow.cells.forEach((cell) => Object.freeze(cell));
      Object.freeze(pdfRow.cells);
      Object.freeze(pdfRow);
    }
    Object.freeze(rows);
    expect(parseSuccess(rows)).toEqual(parseSuccess(rows));
    expect(rows).toEqual(originalRows);
    expect(fixtureItems).toEqual(originalItems);
  });
});

describe("parseHyundaiStatement layout and limits", () => {
  it.each(["1,82,075원", "1820075원", "1,820,075", "9,007,199,254,740,992원"])
    ("rejects an invalid or unsafe statement amount %s", (amount) => {
      expect(parseHyundaiStatement([
        row(["10월 23일 명세서"]), row([amount]),
      ])).toEqual({ ok: false, code: "UNREADABLE", reason: "broken_layout" });
    });

  it("requires the total immediately after the first header", () => {
    const rows = statementRows("1,000", ["QS25", "1,000", "원"], ["일시불 현대카드MM"]);
    rows.splice(1, 0, row(["이용 안내"]));
    expect(parseHyundaiStatement(rows)).toEqual({
      ok: false, code: "UNREADABLE", reason: "broken_layout",
    });
    expect(parseHyundaiStatement([row(["10월 23일 명세서"])]))
      .toEqual({ ok: false, code: "UNREADABLE", reason: "broken_layout" });
  });

  it.each([
    ["QS25", "1,000", "원"],
    ["QS25", "1,000원"],
    ["QS25", " 1000 ", " 원 "],
  ])("reads amount cells independently of the numeric merchant suffix: %j", (...cells) => {
    const { transactions } = parseSuccess(statementRows(
      "1,000", cells, ["일시불 현대카드MM"],
    ));
    expect(transactions).toEqual([{
      date: "2026-10-11", merchant: "QS25", merchantKey: "QS25", amount: 1_000,
      eventKind: "purchase", sourceEventKey: "2026-10-11|QS25|1000|0",
    }]);
  });

  it("does not infer a transaction by splitting a merchant and amount in one cell", () => {
    expect(parseHyundaiStatement(statementRows(
      "1,000", ["QS251,000원"], ["일시불 현대카드MM"],
    ))).toEqual({ ok: false, code: "UNREADABLE", reason: "no_transactions" });
  });

  it("normalizes whitespace and suffixes while retaining merchant punctuation", () => {
    const { transactions } = parseSuccess(statementRows(
      "1,000", ["  Acme*  ", "Cloud ＳＵＢ (USD : 22.00)  ", "1,000", "원"],
      ["일시불 현대카드MM"],
    ));
    expect(transactions[0]).toMatchObject({
      merchant: "Acme* Cloud ＳＵＢ", merchantKey: "ACME* CLOUD SUB",
      sourceEventKey: "2026-10-11|ACME*CLOUDSU|1000|0",
    });
  });

  it.each([{ merchant: [] }, { merchant: ["  "] }, { merchant: ["(USD:22.00)"] }])
    ("rejects an empty merchant after cleaning $merchant", ({ merchant }) => {
      expect(parseHyundaiStatement(statementRows(
        "1,000", [...merchant, "1,000", "원"], ["일시불 현대카드MM"],
      ))).toEqual({ ok: false, code: "UNREADABLE", reason: "broken_layout" });
    });

  // 2026-10-14에 받은 명세서는 해외 결제 가맹점명을 20자로 자르고 ",통화:금액"을 붙여 다음 줄로 넘긴다.
  it("appends a wrapped foreign-currency tail to the merchant name", () => {
    const { transactions } = parseSuccess(statementRows(
      "30,131", ["ANTHROPIC* CLAUDE", "30,131", "원"], ["SU,USD:22.00"], ["일시불 현대카드MM"],
    ));
    expect(transactions).toEqual([{
      date: "2026-10-11",
      merchant: "ANTHROPIC* CLAUDE SU",
      merchantKey: "ANTHROPIC* CLAUDE SU",
      amount: 30_131,
      eventKind: "purchase",
      sourceEventKey: "2026-10-11|ANTHROPIC*CL|30131|0",
    }]);
  });

  it.each([
    { tail: [",USD:22.00"], merchant: "ANTHROPIC* CLAUDE" },
    { tail: ["SUBS,KRW:29000.00"], merchant: "ANTHROPIC* CLAUDE SUBS" },
    { tail: ["SUR , EUR : 2,00"], merchant: "ANTHROPIC* CLAUDE SUR" },
  ])("reads the currency tail line $tail", ({ tail, merchant }) => {
    const { transactions } = parseSuccess(statementRows(
      "30,131", ["ANTHROPIC* CLAUDE", "30,131원"], tail, ["일시불 현대카드MM"],
    ));
    expect(transactions[0].merchant).toBe(merchant);
  });

  it("strips a comma currency suffix on the merchant line", () => {
    const { transactions } = parseSuccess(statementRows(
      "15,073", ["OPENAI", ",USD:", "11.00", "15,073", "원"], ["일시불 현대카드MM"],
    ));
    expect(transactions[0]).toMatchObject({ merchant: "OPENAI", sourceEventKey: "2026-10-11|OPENAI|15073|0" });
  });

  // 취소된 거래는 결제 방식 줄이 0원이 되고, 적립 줄 아래에 "결제 취소 -금액원" 줄이 붙는다.
  it("reads a payment cancellation row as a cancel of the transaction above", () => {
    const { transactions, statementTotal } = parseSuccess(statementRows(
      "3,000",
      ["(주)결제대행 - 결제가게 햇살마을점", "254,000", "원"],
      ["일시불 현대카드MM", "0원"],
      ["현대 포인트 3,810(1.5%)"],
      ["결제 취소 ", "-254,000", "원"],
      ["QS25", "3,000원"],
      ["일시불 현대카드MM"],
    ));
    expect(statementTotal).toBe(3_000);
    expect(transactions.map(({ merchant, amount, eventKind, sourceEventKey }) => ({
      merchant, amount, eventKind, sourceEventKey,
    }))).toEqual([
      {
        merchant: "(주)결제대행 - 결제가게 햇살마을점", amount: 254_000, eventKind: "purchase",
        sourceEventKey: "2026-10-11|(주)결제대행-결제가게|254000|0",
      },
      {
        merchant: "(주)결제대행 - 결제가게 햇살마을점", amount: -254_000, eventKind: "cancel",
        sourceEventKey: "2026-10-11|(주)결제대행-결제가게|-254000|0",
      },
      { merchant: "QS25", amount: 3_000, eventKind: "purchase", sourceEventKey: "2026-10-11|QS25|3000|0" },
    ]);
  });

  it("rejects a payment cancellation row with no transaction above it on the same date", () => {
    expect(parseHyundaiStatement(statementRows("-1,000", ["결제 취소", "-1,000원"])))
      .toEqual({ ok: false, code: "UNREADABLE", reason: "broken_layout" });
    const rows = statementRows("0", ["QS25", "1,000원"], ["일시불 현대카드MM"]);
    rows.push(row(["26. 10. 10 (토)"]), row(["결제 취소", "-1,000원"]));
    expect(parseHyundaiStatement(rows)).toEqual({ ok: false, code: "UNREADABLE", reason: "broken_layout" });
  });

  it("rejects a payment cancellation row with a positive amount", () => {
    expect(parseHyundaiStatement(statementRows(
      "2,000", ["QS25", "1,000원"], ["일시불 현대카드MM"], ["결제 취소", "1,000원"],
    ))).toEqual({ ok: false, code: "UNREADABLE", reason: "cancel_label" });
  });

  it("skips multiple currency lines across pages before the payment method", () => {
    const rows = statementRows("1,000", ["QS25", "1,000원"]);
    rows.push(row(["(USD:1.00)"]), row(["(EUR : 2,00)"], 2), row(["일시불 현대카드MM"], 2));
    expect(parseSuccess(rows).transactions).toHaveLength(1);
  });

  it.each([
    { following: [] },
    { following: [["(USD:1.00)"]] },
    { following: [["일시불 다른카드"]] },
  ])
    ("rejects an absent or non-Hyundai payment method $following", ({ following }) => {
      expect(parseHyundaiStatement(statementRows(
        "1,000", ["QS25", "1,000원"], ...following,
      ))).toEqual({ ok: false, code: "UNREADABLE", reason: "broken_layout" });
    });

  it("accepts a negative statement total and cancellation labels on negative amounts", () => {
    const { transactions, statementTotal } = parseSuccess(statementRows(
      "-1,000", ["QS25 취소", "-1,000원"], ["일시불 현대카드MM 취소"],
    ));
    expect(statementTotal).toBe(-1_000);
    expect(transactions[0]).toMatchObject({ amount: -1_000, eventKind: "cancel" });
  });

  it("skips zero amounts while still consuming and validating their payment method", () => {
    const rows = statementRows(
      "1,000", ["QS25", "0원"], ["일시불 현대카드MM"],
      ["QS25", "1,000원"], ["일시불 현대카드MM"],
    );
    expect(parseSuccess(rows).transactions).toHaveLength(1);
    expect(parseHyundaiStatement(statementRows("0", ["QS25", "0원"])))
      .toEqual({ ok: false, code: "UNREADABLE", reason: "broken_layout" });
  });

  it("rejects an empty statement before comparing totals", () => {
    expect(parseHyundaiStatement(statementRows("1,000")))
      .toEqual({ ok: false, code: "UNREADABLE", reason: "no_transactions" });
    expect(parseHyundaiStatement(statementRows("0", ["QS25", "0원"], ["일시불 현대카드MM"])))
      .toEqual({ ok: false, code: "UNREADABLE", reason: "no_transactions" });
  });

  it("uses calendar month lengths and accepts leap day", () => {
    const rows = statementRows("1,000", ["QS25", "1,000원"], ["일시불 현대카드MM"]);
    rows[2] = row(["24. 2. 29 (목)"]);
    expect(parseSuccess(rows).transactions[0].date).toBe("2024-02-29");
    rows[2] = row(["26. 2. 29 (일)"]);
    expect(parseHyundaiStatement(rows))
      .toEqual({ ok: false, code: "UNREADABLE", reason: "broken_layout" });
  });

  it.each([5_000, 5_001])("enforces the transaction limit at %i rows", (count) => {
    expect(MAX_TRANSACTIONS).toBe(5_000);
    const body = Array.from({ length: count }, () => [
      ["테스트 가맹점", "1", "원"], ["일시불 현대카드MM"],
    ]).flat();
    const rows = statementRows(count.toLocaleString("en-US"), ...body);
    if (count === 5_000) expect(parseSuccess(rows).transactions).toHaveLength(count);
    else expect(parseHyundaiStatement(rows))
      .toEqual({ ok: false, code: "UNREADABLE", reason: "too_many_rows" });
  });

  it("compares totals exactly even when intermediate sums exceed safe integers", () => {
    expect(parseHyundaiStatement(statementRows(
      "1", ["첫 결제", "9,007,199,254,740,991원"], ["일시불 현대카드MM"],
      ["둘째 결제", "2원"], ["일시불 현대카드MM"],
      ["환불", "-9,007,199,254,740,991원"], ["일시불 현대카드MM"],
    ))).toEqual({ ok: false, code: "UNREADABLE", reason: "total_mismatch" });
  });
});
