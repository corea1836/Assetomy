import { describe, expect, it } from "vitest";
import type { Transaction } from "@/types/transaction";
import {
  detectDuplicates,
  detectFindings,
  detectLarge,
  detectRecurring,
  DUPLICATE_MIN_AMOUNT,
  LARGE_MEDIAN_MULTIPLIER,
  LARGE_MIN_SAMPLE,
  RECURRING_AMOUNT_TOLERANCE,
  RECURRING_MAX_GAP_DAYS,
  RECURRING_MIN_GAP_DAYS,
  summarizeFindings,
} from "./detection";

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-default",
    cardId: "card-a",
    cardLabel: "생활비 카드",
    statementDate: null,
    date: "2026-09-15",
    merchant: "식당",
    merchantKey: "restaurant",
    amount: 10_000,
    category: "food",
    ...overrides,
  };
}

function ordinaryPurchases(count: number, amount = 1_000): Transaction[] {
  return Array.from({ length: count }, (_, index) => transaction({
    id: `sample-${index}`,
    date: "2026-08-01",
    amount,
  }));
}

describe("detection thresholds", () => {
  it("exports the specified thresholds", () => {
    expect(RECURRING_MIN_GAP_DAYS).toBe(28);
    expect(RECURRING_MAX_GAP_DAYS).toBe(35);
    expect(RECURRING_AMOUNT_TOLERANCE).toBe(0.1);
    expect(DUPLICATE_MIN_AMOUNT).toBe(10_000);
    expect(LARGE_MIN_SAMPLE).toBe(20);
    expect(LARGE_MEDIAN_MULTIPLIER).toBe(10);
  });
});

describe("detectRecurring", () => {
  it("returns only the selected month's payment and all three series months", () => {
    const transactions = [
      transaction({ id: "july", date: "2026-07-15", merchant: "이전 이름" }),
      transaction({ id: "august", date: "2026-08-15", category: "subscription" }),
      transaction({ id: "september", merchant: "나중 이름", category: "etc" }),
    ];

    expect(detectRecurring(transactions, "2026-08")).toEqual([{
      kind: "recurring",
      merchantKey: "restaurant",
      merchant: "식당",
      category: "subscription",
      amount: 10_000,
      transactions: [{
        id: "august", date: "2026-08-15", amount: 10_000, cardLabel: "생활비 카드",
      }],
      seriesMonths: ["2026-07", "2026-08", "2026-09"],
    }]);
  });

  it.each([
    ["2026-02-11", false], // 27 days
    ["2026-02-12", true], // 28 days
    ["2026-02-19", true], // 35 days
    ["2026-02-20", false], // 36 days
  ] as const)("applies the inclusive gap boundaries for %s", (date, recurring) => {
    expect(detectRecurring([
      transaction({ id: "first", date: "2026-01-15" }),
      transaction({ id: "second", date }),
    ], "2026-02")).toHaveLength(recurring ? 1 : 0);
  });

  it.each([
    [11_000, true],
    [9_000, true],
    [11_100, false],
    [8_900, false],
  ] as const)("applies the inclusive amount tolerance for %i", (amount, recurring) => {
    expect(detectRecurring([
      transaction({ id: "first", date: "2026-08-15" }),
      transaction({ id: "second", amount }),
    ], "2026-09")).toHaveLength(recurring ? 1 : 0);
  });

  it("compares each payment to its immediate predecessor's amount", () => {
    const findings = detectRecurring([
      transaction({ id: "july", date: "2026-07-15", amount: 10_000 }),
      transaction({ id: "august", date: "2026-08-15", amount: 11_000 }),
      transaction({ id: "september", amount: 12_100 }),
    ], "2026-09");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      amount: 12_100,
      seriesMonths: ["2026-07", "2026-08", "2026-09"],
    });
    expect(detectRecurring([
      transaction({ id: "first", date: "2026-08-15", amount: 9_000 }),
      transaction({ id: "second", amount: 10_000 }),
    ], "2026-09")).toEqual([]);
  });

  it("does not detect a single month's payment or a month without a payment", () => {
    expect(detectRecurring([transaction()], "2026-09")).toEqual([]);
    expect(detectRecurring([
      transaction({ id: "july", date: "2026-07-15" }),
      transaction({ id: "august", date: "2026-08-15" }),
    ], "2026-09")).toEqual([]);
  });

  it.each(["2026-08", "2026-09"])("excludes every payment in a cafe's multi-payment month %s", (month) => {
    const transactions = ["2026-07", "2026-08", "2026-09"].map((month) =>
      transaction({ id: month, date: `${month}-15`, category: "cafe" }),
    );
    transactions.push(transaction({
      id: "extra-payment", date: `${month}-16`, category: "cafe",
    }));

    expect(detectRecurring(transactions, "2026-09")).toEqual([]);
  });

  it("keeps valid series in other months after excluding a multi-payment month", () => {
    expect(detectRecurring([
      transaction({ id: "july-a", date: "2026-07-15" }),
      transaction({ id: "july-b", date: "2026-07-16" }),
      transaction({ id: "august", date: "2026-08-15" }),
      transaction({ id: "september" }),
    ], "2026-09")).toMatchObject([{
      seriesMonths: ["2026-08", "2026-09"],
      transactions: [{ id: "september" }],
    }]);
  });

  it("starts a new series when the amount or gap breaks the chain", () => {
    const transactions = [
      transaction({ id: "july", date: "2026-07-15" }),
      transaction({ id: "august", date: "2026-08-15" }),
      transaction({ id: "september", amount: 20_000 }),
      transaction({ id: "october", date: "2026-10-15", amount: 20_000 }),
    ];

    expect(detectRecurring(transactions, "2026-09")).toMatchObject([{
      amount: 20_000,
      seriesMonths: ["2026-09", "2026-10"],
    }]);
    expect(detectRecurring([
      transaction({ id: "june", date: "2026-06-15" }),
      transaction({ id: "july", date: "2026-07-15" }),
      transaction({ id: "september" }),
      transaction({ id: "october", date: "2026-10-15" }),
    ], "2026-09")).toMatchObject([{
      seriesMonths: ["2026-09", "2026-10"],
    }]);
  });

  it("ignores nonpositive transactions when counting payments and building series", () => {
    expect(detectRecurring([
      transaction({ id: "august", date: "2026-08-15" }),
      transaction({ id: "september" }),
      transaction({ id: "refund", date: "2026-09-16", amount: -10_000 }),
      transaction({ id: "zero", date: "2026-08-16", amount: 0 }),
    ], "2026-09")).toMatchObject([{
      amount: 10_000,
      seriesMonths: ["2026-08", "2026-09"],
      transactions: [{ id: "september" }],
    }]);
  });

  it("groups by merchantKey across cards and keeps different merchants separate", () => {
    expect(detectRecurring([
      transaction({ id: "august", date: "2026-08-15" }),
      transaction({ id: "september", cardId: "card-b", cardLabel: "다른 카드" }),
    ], "2026-09")).toMatchObject([{
      transactions: [{ id: "september", cardLabel: "다른 카드" }],
    }]);
    expect(detectRecurring([
      transaction({ id: "august", date: "2026-08-15" }),
      transaction({ id: "september", merchantKey: "different" }),
    ], "2026-09")).toEqual([]);
  });
});

describe("detectDuplicates", () => {
  it("returns both positive payments and uses the greatest id for same-day details", () => {
    expect(detectDuplicates([
      transaction({ id: "z", merchant: "최신 표시명", category: "shopping" }),
      transaction({ id: "a", merchant: "이전 표시명" }),
    ], "2026-09")).toEqual([{
      kind: "duplicate",
      merchantKey: "restaurant",
      merchant: "최신 표시명",
      category: "shopping",
      amount: 20_000,
      transactions: [
        { id: "a", date: "2026-09-15", amount: 10_000, cardLabel: "생활비 카드" },
        { id: "z", date: "2026-09-15", amount: 10_000, cardLabel: "생활비 카드" },
      ],
    }]);
  });

  it.each([
    { cardId: "card-b" },
    { date: "2026-09-16" },
    { merchantKey: "different" },
    { amount: 20_000 },
  ])("keeps payments separate for a different group key %j", (overrides) => {
    expect(detectDuplicates([
      transaction({ id: "first" }),
      transaction({ id: "second", ...overrides }),
    ], "2026-09")).toEqual([]);
  });

  it.each([
    { amount: 9_999 },
    { category: "transport" as const },
  ])("excludes ineligible payments %j", (overrides) => {
    expect(detectDuplicates([
      transaction({ id: "first", ...overrides }),
      transaction({ id: "second", ...overrides }),
    ], "2026-09")).toEqual([]);
  });

  it("subtracts matching cancellations from any month in the input", () => {
    expect(detectDuplicates([
      transaction({ id: "first" }),
      transaction({ id: "second" }),
      transaction({ id: "refund", date: "2026-10-01", amount: -10_000 }),
    ], "2026-09")).toEqual([]);
  });

  it("keeps all three positive payments when one cancellation leaves two", () => {
    const findings = detectDuplicates([
      transaction({ id: "first" }),
      transaction({ id: "second" }),
      transaction({ id: "third" }),
      transaction({ id: "refund", date: "2026-08-31", amount: -10_000 }),
    ], "2026-09");

    expect(findings).toHaveLength(1);
    expect(findings[0].amount).toBe(30_000);
    expect(findings[0].transactions.map((item) => item.id)).toEqual([
      "first", "second", "third",
    ]);
  });

  it.each([
    { cardId: "card-b" },
    { merchantKey: "different" },
    { amount: -9_999 },
  ])("does not subtract a cancellation with different keys %j", (overrides) => {
    expect(detectDuplicates([
      transaction({ id: "first" }),
      transaction({ id: "second" }),
      transaction({ id: "refund", amount: -10_000, ...overrides }),
    ], "2026-09")).toHaveLength(1);
  });

  it("subtracts the count of all matching cancellations", () => {
    expect(detectDuplicates([
      transaction({ id: "first" }),
      transaction({ id: "second" }),
      transaction({ id: "third" }),
      transaction({ id: "refund-a", amount: -10_000 }),
      transaction({ id: "refund-b", date: "2026-10-01", amount: -10_000 }),
    ], "2026-09")).toEqual([]);
  });

  it("applies the cancellation count to each matching date group", () => {
    expect(detectDuplicates([
      transaction({ id: "day-one-a", date: "2026-09-01" }),
      transaction({ id: "day-one-b", date: "2026-09-01" }),
      transaction({ id: "day-two-a", date: "2026-09-02" }),
      transaction({ id: "day-two-b", date: "2026-09-02" }),
      transaction({ id: "refund", amount: -10_000 }),
    ], "2026-09")).toEqual([]);
  });

  it("excludes positive groups outside the selected month", () => {
    expect(detectDuplicates([
      transaction({ id: "august-a", date: "2026-08-15" }),
      transaction({ id: "august-b", date: "2026-08-15" }),
      transaction({ id: "september" }),
    ], "2026-09")).toEqual([]);
  });
});

describe("detectLarge", () => {
  it("requires twenty positive samples, ignoring refunds and zero amounts", () => {
    expect(detectLarge([
      ...ordinaryPurchases(18),
      transaction({ id: "large", amount: 10_001 }),
      transaction({ id: "refund", amount: -100_000 }),
      transaction({ id: "zero", amount: 0 }),
    ], "2026-09")).toEqual([]);
  });

  it("uses the entire input's median and detects only amounts strictly above ten times it", () => {
    expect(detectLarge([
      ...ordinaryPurchases(18),
      transaction({ id: "boundary", amount: 10_000 }),
      transaction({ id: "large", amount: 10_001, merchant: "고액 가맹점" }),
    ], "2026-09")).toEqual([{
      kind: "large",
      merchantKey: "restaurant",
      merchant: "고액 가맹점",
      category: "food",
      amount: 10_001,
      transactions: [{
        id: "large", date: "2026-09-15", amount: 10_001, cardLabel: "생활비 카드",
      }],
    }]);
  });

  it("averages the middle two amounts for an even sample without rounding", () => {
    expect(detectLarge([
      ...ordinaryPurchases(10),
      ...ordinaryPurchases(8, 1_001).map((item) => ({ ...item, id: `high-${item.id}` })),
      transaction({ id: "boundary", amount: 10_005 }),
      transaction({ id: "large", amount: 10_006 }),
    ], "2026-09")).toMatchObject([{
      amount: 10_006,
      transactions: [{ id: "large" }],
    }]);
  });

  it("uses the middle amount for an odd sample and ignores nonpositive amounts", () => {
    expect(detectLarge([
      ...ordinaryPurchases(10),
      ...ordinaryPurchases(9, 3_000).map((item) => ({ ...item, id: `high-${item.id}` })),
      transaction({ id: "boundary", amount: 30_000 }),
      transaction({ id: "large", amount: 30_001 }),
      transaction({ id: "refund", amount: -100_000 }),
      transaction({ id: "zero", amount: 0 }),
    ], "2026-09")).toMatchObject([{
      amount: 30_001,
      transactions: [{ id: "large" }],
    }]);
  });

  it("excludes large payments outside the selected month", () => {
    expect(detectLarge([
      ...ordinaryPurchases(18),
      transaction({ id: "previous", date: "2026-08-15", amount: 90_000 }),
      transaction({ id: "current", amount: 20_000 }),
    ], "2026-09")).toMatchObject([{
      amount: 20_000,
      transactions: [{ id: "current" }],
    }]);
  });
});

const mixedTransactions: Transaction[] = [
  ...ordinaryPurchases(20),
  ...[
    { merchantKey: "r-z", amount: 5_000 },
    { merchantKey: "r-b", amount: 2_000 },
    { merchantKey: "r-a", amount: 2_000 },
  ].flatMap(({ merchantKey, amount }) => [
    transaction({ id: `${merchantKey}-previous`, date: "2026-08-15", merchantKey, amount }),
    transaction({ id: `${merchantKey}-current`, merchantKey, amount }),
  ]),
  ...[
    { merchantKey: "d-z", amount: 20_000 },
    { merchantKey: "d-b", amount: 10_000 },
    { merchantKey: "d-a", amount: 10_000 },
  ].flatMap(({ merchantKey, amount }) => [
    transaction({ id: `${merchantKey}-b`, merchantKey, amount }),
    transaction({ id: `${merchantKey}-a`, merchantKey, amount }),
  ]),
  transaction({ id: "l-z", merchantKey: "l-z", amount: 40_000 }),
  transaction({ id: "l-b", merchantKey: "l-b", amount: 30_000 }),
  transaction({ id: "l-a", merchantKey: "l-a", amount: 30_000 }),
];

describe("detectFindings", () => {
  it("sorts by kind, descending amount and ascending merchantKey", () => {
    expect(detectFindings(mixedTransactions, "2026-09")
      .map(({ kind, merchantKey, amount }) => ({ kind, merchantKey, amount })))
      .toEqual([
        { kind: "recurring", merchantKey: "r-z", amount: 5_000 },
        { kind: "recurring", merchantKey: "r-a", amount: 2_000 },
        { kind: "recurring", merchantKey: "r-b", amount: 2_000 },
        { kind: "duplicate", merchantKey: "d-z", amount: 40_000 },
        { kind: "duplicate", merchantKey: "d-a", amount: 20_000 },
        { kind: "duplicate", merchantKey: "d-b", amount: 20_000 },
        { kind: "large", merchantKey: "l-z", amount: 40_000 },
        { kind: "large", merchantKey: "l-a", amount: 30_000 },
        { kind: "large", merchantKey: "l-b", amount: 30_000 },
        { kind: "large", merchantKey: "d-z", amount: 20_000 },
        { kind: "large", merchantKey: "d-z", amount: 20_000 },
      ]);
  });

  it("returns empty results for empty input in every detector", () => {
    for (const detect of [detectRecurring, detectDuplicates, detectLarge, detectFindings]) {
      expect(detect([], "2026-09")).toEqual([]);
    }
  });

  it("returns identical results for reordered input without mutating transactions", () => {
    const transactions = [
      ...mixedTransactions.map((item) => ({ ...item })),
      transaction({ id: "other-card-b", merchantKey: "d-z", amount: 20_000, cardId: "card-b" }),
      transaction({ id: "other-card-a", merchantKey: "d-z", amount: 20_000, cardId: "card-b" }),
      transaction({ id: "other-day-b", date: "2026-09-16", merchantKey: "d-z", amount: 20_000 }),
      transaction({ id: "other-day-a", date: "2026-09-16", merchantKey: "d-z", amount: 20_000 }),
    ];
    const original = transactions.map((item) => ({ ...item }));
    transactions.forEach(Object.freeze);
    Object.freeze(transactions);
    const orders = [
      [...transactions].reverse(),
      [...transactions.slice(7), ...transactions.slice(0, 7)],
      [...transactions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    ];

    for (const detect of [detectRecurring, detectDuplicates, detectLarge, detectFindings]) {
      const findings = detect(transactions, "2026-09");
      for (const reordered of orders) {
        expect(detect(reordered, "2026-09")).toEqual(findings);
      }
      for (const finding of findings) {
        expect(finding.amount).toBe(finding.transactions.reduce((sum, item) => sum + item.amount, 0));
        expect(finding.transactions.every((item) => item.date.startsWith("2026-09-"))).toBe(true);
        for (const item of finding.transactions) {
          expect(Object.keys(item).sort()).toEqual(["amount", "cardLabel", "date", "id"]);
        }
      }
    }
    expect(transactions).toEqual(original);
  });
});

describe("summarizeFindings", () => {
  it("counts a payment in each kind but once in candidateTotal", () => {
    const findings = detectFindings([
      ...ordinaryPurchases(18),
      transaction({ id: "previous", date: "2026-08-15", merchantKey: "subscription", amount: 10_001 }),
      transaction({ id: "current", merchantKey: "subscription", amount: 10_001 }),
    ], "2026-09");

    expect(summarizeFindings(findings)).toEqual({
      byKind: {
        recurring: { count: 1, amount: 10_001 },
        duplicate: { count: 0, amount: 0 },
        large: { count: 1, amount: 10_001 },
      },
      candidateTotal: 10_001,
    });
  });

  it("counts findings by kind and retains different ids with identical amounts", () => {
    const findings = detectFindings(mixedTransactions, "2026-09");
    const original = structuredClone(findings);
    for (const finding of findings) {
      finding.transactions.forEach(Object.freeze);
      Object.freeze(finding.transactions);
      if (finding.kind === "recurring") Object.freeze(finding.seriesMonths);
      Object.freeze(finding);
    }
    Object.freeze(findings);
    const summary = summarizeFindings(findings);

    expect(summary).toEqual({
      byKind: {
        recurring: { count: 3, amount: 9_000 },
        duplicate: { count: 3, amount: 80_000 },
        large: { count: 5, amount: 140_000 },
      },
      candidateTotal: 189_000,
    });
    expect(summarizeFindings([...findings].reverse())).toEqual(summary);
    expect(findings).toEqual(original);
    expect(Number.isSafeInteger(summary.candidateTotal)).toBe(true);
  });

  it("fills every kind with zeros for empty input", () => {
    expect(summarizeFindings([])).toEqual({
      byKind: {
        recurring: { count: 0, amount: 0 },
        duplicate: { count: 0, amount: 0 },
        large: { count: 0, amount: 0 },
      },
      candidateTotal: 0,
    });
  });
});
