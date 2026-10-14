import { describe, expect, it } from "vitest";
import { CATEGORY_IDS } from "@/types/category";
import type { Transaction } from "@/types/transaction";
import { buildMonthComparison, buildMonthOverMonth, buildTrend, TREND_MAX_MONTHS } from "./comparison";
import { addMonths } from "./dates";
import { buildSnapshot } from "./snapshot";

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-default",
    cardId: "card-a",
    cardLabel: "생활비 카드",
    statementDate: null,
    date: "2026-09-15",
    merchant: "식당",
    merchantKey: "restaurant",
    amount: 1_000,
    category: "food",
    ...overrides,
  };
}

// 카드 내역이 2026년 8·9월을 다 덮도록 두 달 바깥에 거래를 둔다(전월 비교 조건이고 두 달 합계에는 영향이 없다).
function coverAugustToSeptember(cardId = "card-a"): Transaction[] {
  return [
    transaction({ id: `${cardId}-before`, cardId, date: "2026-07-31", amount: 1 }),
    transaction({ id: `${cardId}-after`, cardId, date: "2026-10-01", amount: 1 }),
  ];
}

describe("buildMonthOverMonth", () => {
  it.each([
    ["2026-09", "2026-09-01"],
    ["2026-09", "2026-09-30"],
    ["2026-10", "2026-09-30"],
  ])("returns null for unfinished month %s relative to %s", (month, today) => {
    const transactions = [
      transaction({ date: `${addMonths(month, -1)}-15`, amount: 10_000 }),
      transaction({ date: `${month}-01`, amount: 20_000 }),
    ];

    expect(buildMonthOverMonth(transactions, month, today)).toBeNull();
  });

  it("returns null when the previous month has no transactions", () => {
    expect(buildMonthOverMonth([], "2026-09", "2026-10-01")).toBeNull();
    expect(buildMonthOverMonth([
      transaction({ date: "2026-07-31" }),
      transaction({ date: "2026-09-01" }),
    ], "2026-09", "2026-10-01")).toBeNull();
  });

  it.each([
    [30_001, 20_000],
    [4_003, -5_998],
    [10_001, 0],
  ])("compares a current total of %i with the previous total", (amount, diff) => {
    const transactions = [
      transaction({ date: "2026-08-31", amount: 10_001 }),
      transaction({ date: "2026-09-01", amount }),
      transaction({ date: "2026-07-31", amount: 900_000 }),
      transaction({ date: "2026-10-01", amount: 800_000 }),
    ];

    expect(buildMonthOverMonth(transactions, "2026-09", "2026-10-01")).toEqual({
      previousMonth: "2026-08",
      previousTotal: 10_001,
      diff,
    });
  });

  it("includes refunds and both cards using the same totals as snapshots", () => {
    const transactions = [
      transaction({ date: "2026-08-01", amount: 12_001 }),
      transaction({ date: "2026-08-31", amount: -3_001 }),
      transaction({ id: "card-a-purchase", amount: 12_001 }),
      transaction({ id: "card-b-purchase", cardId: "card-b", amount: 12_001 }),
      transaction({ amount: -4_003 }),
      ...coverAugustToSeptember("card-a"),
      ...coverAugustToSeptember("card-b"),
    ];
    const previous = buildSnapshot(transactions, "2026-08", "2026-10-01");
    const current = buildSnapshot(transactions, "2026-09", "2026-10-01");
    const mom = buildMonthOverMonth(transactions, "2026-09", "2026-10-01");

    expect(mom).toEqual({
      previousMonth: "2026-08",
      previousTotal: 9_000,
      diff: 10_999,
    });
    expect(mom?.previousTotal).toBe(previous.total);
    expect(mom?.diff).toBe(current.total - previous.total);
  });

  it("compares against a previous month whose purchases and refunds sum to zero", () => {
    expect(buildMonthOverMonth([
      transaction({ date: "2026-08-01", amount: 1_001 }),
      transaction({ date: "2026-08-31", amount: -1_001 }),
      transaction({ amount: 2_003 }),
      ...coverAugustToSeptember(),
    ], "2026-09", "2026-10-01")).toEqual({
      previousMonth: "2026-08",
      previousTotal: 0,
      diff: 2_003,
    });
  });

  it("keeps negative monthly totals", () => {
    expect(buildMonthOverMonth([
      transaction({ date: "2026-08-01", amount: -1_001 }),
      transaction({ amount: -2_003 }),
      ...coverAugustToSeptember(),
    ], "2026-09", "2026-10-01")).toEqual({
      previousMonth: "2026-08",
      previousTotal: -1_001,
      diff: -1_002,
    });
  });

  it("uses December as the previous month for January", () => {
    expect(buildMonthOverMonth([
      transaction({ date: "2025-12-31", amount: 1_001 }),
      transaction({ date: "2026-01-01", amount: 2_003 }),
      transaction({ id: "before", date: "2025-11-30" }),
      transaction({ id: "after", date: "2026-02-01" }),
    ], "2026-01", "2026-02-01")).toEqual({
      previousMonth: "2025-12",
      previousTotal: 1_001,
      diff: 1_002,
    });
  });

  it("uses zero for a selected month without transactions", () => {
    expect(buildMonthOverMonth([
      transaction({ date: "2026-08-31", amount: 1_001 }),
      ...coverAugustToSeptember(),
    ], "2026-09", "2026-10-01")).toEqual({
      previousMonth: "2026-08",
      previousTotal: 1_001,
      diff: -1_001,
    });
  });
});

describe("buildMonthComparison", () => {
  const today = "2026-10-14";
  function span(cardId: string, from: string, to: string): Transaction[] {
    return [
      transaction({ id: `${cardId}-from`, cardId, date: from, amount: 1_000 }),
      transaction({ id: `${cardId}-to`, cardId, date: to, amount: 2_000 }),
    ];
  }

  it("skips the comparison and names the previous month when a card starts more than three days into it", () => {
    expect(buildMonthComparison(span("card-a", "2026-08-12", "2026-10-11"), "2026-09", today))
      .toEqual({ mom: null, partialMonth: "2026-08" });
  });

  it("compares when every active card covers both months", () => {
    const transactions = [
      ...span("card-a", "2026-07-12", "2026-10-11"),
      transaction({ id: "aug", date: "2026-08-20", amount: 5_000 }),
      transaction({ id: "sep", date: "2026-09-20", amount: 8_000 }),
    ];
    expect(buildMonthComparison(transactions, "2026-09", today)).toEqual({
      mom: { previousMonth: "2026-08", previousTotal: 5_000, diff: 3_000 },
      partialMonth: null,
    });
  });

  it.each([
    ["2026-08-04", "2026-09-27", null],
    ["2026-08-05", "2026-09-27", "2026-08"],
    ["2026-08-04", "2026-09-26", "2026-09"],
  ])("treats up to three missing days at a month edge as covered: %s~%s", (from, to, partialMonth) => {
    expect(buildMonthComparison(span("card-a", from, to), "2026-09", today).partialMonth).toBe(partialMonth);
  });

  it("checks every card with transactions in either month", () => {
    const transactions = [...span("card-a", "2026-07-12", "2026-10-11"), ...span("card-b", "2026-08-12", "2026-09-30")];
    expect(buildMonthComparison(transactions, "2026-09", today)).toEqual({ mom: null, partialMonth: "2026-08" });
  });

  it("names the selected month when a card stops more than three days before its end", () => {
    const transactions = [...span("card-a", "2026-07-01", "2026-09-20"), transaction({ id: "aug", date: "2026-08-15" })];
    expect(buildMonthComparison(transactions, "2026-09", today)).toEqual({ mom: null, partialMonth: "2026-09" });
  });

  it("ignores cards without transactions in either month", () => {
    const transactions = [
      ...span("card-a", "2026-07-12", "2026-10-11"),
      transaction({ id: "june-only", cardId: "card-c", date: "2026-06-15" }),
      ...span("card-d", "2026-07-20", "2026-10-02"),
    ];
    expect(buildMonthComparison(transactions, "2026-09", today).partialMonth).toBeNull();
  });

  it("reports no partial month for an unfinished month or a previous month without data", () => {
    expect(buildMonthComparison(span("card-a", "2026-09-12", "2026-10-11"), "2026-10", today))
      .toEqual({ mom: null, partialMonth: null });
    expect(buildMonthComparison(span("card-a", "2026-09-12", "2026-09-30"), "2026-09", today))
      .toEqual({ mom: null, partialMonth: null });
  });

  it("keeps buildMonthOverMonth and the trend category changes in line with the comparison", () => {
    const transactions = [...span("card-a", "2026-08-12", "2026-10-11"), transaction({ id: "sep", date: "2026-09-15" })];
    expect(buildMonthOverMonth(transactions, "2026-09", today)).toBeNull();
    const trend = buildTrend(transactions, "2026-09", today);
    expect(trend?.months.map(({ month }) => month)).toEqual(["2026-08", "2026-09"]);
    expect(trend?.categoryChanges).toBeNull();
  });
});

describe("buildTrend", () => {
  it("returns null for empty input or multiple transactions in only one month", () => {
    expect(buildTrend([], "2026-09", "2026-10-01")).toBeNull();
    expect(buildTrend([
      transaction({ id: "first", date: "2026-08-01" }),
      transaction({ id: "second", date: "2026-08-31" }),
    ], "2026-09", "2026-10-01")).toBeNull();
  });

  it("keeps only the last twelve months from fourteen data months", () => {
    const transactions = Array.from({ length: 14 }, (_, index) =>
      transaction({
        date: `${addMonths("2025-08", index)}-15`,
        amount: index + 1,
      }),
    );
    transactions.push(transaction({ date: "2026-10-01", amount: 999_999 }));
    const trend = buildTrend(transactions, "2026-09", "2026-10-01");

    expect(TREND_MAX_MONTHS).toBe(12);
    expect(trend?.months).toHaveLength(TREND_MAX_MONTHS);
    expect(trend?.months).toEqual([
      { month: "2025-10", total: 3, inProgress: false },
      { month: "2025-11", total: 4, inProgress: false },
      { month: "2025-12", total: 5, inProgress: false },
      { month: "2026-01", total: 6, inProgress: false },
      { month: "2026-02", total: 7, inProgress: false },
      { month: "2026-03", total: 8, inProgress: false },
      { month: "2026-04", total: 9, inProgress: false },
      { month: "2026-05", total: 10, inProgress: false },
      { month: "2026-06", total: 11, inProgress: false },
      { month: "2026-07", total: 12, inProgress: false },
      { month: "2026-08", total: 13, inProgress: false },
      { month: "2026-09", total: 14, inProgress: false },
    ]);
  });

  it("starts at the earliest data month, fills gaps and excludes later months", () => {
    const trend = buildTrend([
      transaction({ date: "2026-03-31", amount: 9_001 }),
      transaction({ date: "2026-06-01", amount: 999_999 }),
      transaction({ date: "2026-01-01", amount: 10_003 }),
    ], "2026-03", "2026-10-01");

    expect(trend).toEqual({
      months: [
        { month: "2026-01", total: 10_003, inProgress: false },
        { month: "2026-02", total: 0, inProgress: false },
        { month: "2026-03", total: 9_001, inProgress: false },
      ],
      categoryChanges: null,
    });
  });

  it("ends at the selected month even when that month has no transactions", () => {
    const trend = buildTrend([
      transaction({ date: "2026-07-01", amount: 1_001 }),
      transaction({ date: "2026-08-01", amount: 2_003 }),
      transaction({ id: "after", date: "2026-10-01" }),
    ], "2026-09", "2026-10-01");

    expect(trend).toEqual({
      months: [
        { month: "2026-07", total: 1_001, inProgress: false },
        { month: "2026-08", total: 2_003, inProgress: false },
        { month: "2026-09", total: 0, inProgress: false },
      ],
      categoryChanges: [{ category: "food", current: 0, previous: 2_003, diff: -2_003 }],
    });
  });

  it.each([
    ["2025-09", "2026-09", "2026-09"],
    ["2026-09", "2026-10", "2026-09"],
    ["2026-09", "2026-10", "2026-08"],
  ])("counts only data months in the selected window (%s, %s, %s)", (first, second, month) => {
    expect(buildTrend([
      transaction({ date: `${first}-15` }),
      transaction({ date: `${second}-15` }),
    ], month, "2026-11-01")).toBeNull();
  });

  it("counts zero and negative net totals as months with transactions", () => {
    const transactions = [
      transaction({ date: "2026-01-01", amount: 1_001 }),
      transaction({ date: "2026-01-31", amount: -1_001 }),
      transaction({ date: "2026-03-01", amount: -2_003 }),
    ];
    const trend = buildTrend(transactions, "2026-03", "2026-04-01");

    expect(trend?.months).toEqual([
      { month: "2026-01", total: 0, inProgress: false },
      { month: "2026-02", total: 0, inProgress: false },
      { month: "2026-03", total: -2_003, inProgress: false },
    ]);
    for (const month of ["2026-01", "2026-03"]) {
      expect(trend?.months.find((item) => item.month === month)?.total).toBe(
        buildSnapshot(transactions, month, "2026-04-01").total,
      );
    }
  });

  it.each(["2026-09-01", "2026-09-30"])("marks the current month in progress relative to %s", (today) => {
    const trend = buildTrend([
      transaction({ date: "2026-08-31" }),
      transaction({ date: "2026-09-01" }),
    ], "2026-09", today);

    expect(trend?.months).toEqual([
      { month: "2026-08", total: 1_000, inProgress: false },
      { month: "2026-09", total: 1_000, inProgress: true },
    ]);
    expect(trend?.categoryChanges).toBeNull();
  });

  it("marks future months, including empty months, in progress", () => {
    const trend = buildTrend([
      transaction({ date: "2026-08-31" }),
      transaction({ date: "2026-10-01" }),
    ], "2026-10", "2026-09-15");

    expect(trend?.months).toEqual([
      { month: "2026-08", total: 1_000, inProgress: false },
      { month: "2026-09", total: 0, inProgress: true },
      { month: "2026-10", total: 1_000, inProgress: true },
    ]);
    expect(trend?.categoryChanges).toBeNull();
  });

  it("sorts category changes by absolute difference, breaks ties by CATEGORY_IDS and omits zero changes", () => {
    const transactions = [
      transaction({ date: "2026-08-01", category: "food", amount: 100 }),
      transaction({ date: "2026-08-01", category: "cafe", amount: 300 }),
      transaction({ date: "2026-08-01", category: "delivery", amount: -100 }),
      transaction({ date: "2026-08-01", category: "transport", amount: 200 }),
      transaction({ date: "2026-08-01", category: "shopping", amount: 200 }),
      transaction({ date: "2026-08-01", category: "health", amount: 100 }),
      transaction({ date: "2026-08-01", category: "subscription", amount: 101 }),
      transaction({ date: "2026-08-31", category: "subscription", amount: -101 }),
      transaction({ category: "food", amount: 400 }),
      transaction({ category: "cafe", amount: 100 }),
      transaction({ category: "delivery", amount: -300 }),
      transaction({ category: "shopping", amount: 400 }),
      transaction({ category: "grocery", amount: 50 }),
      transaction({ category: "health", amount: 100 }),
      transaction({ category: "finance", amount: 101 }),
      transaction({ category: "finance", amount: -101 }),
      transaction({ date: "2026-10-01", category: "travel", amount: 999_999 }),
    ];

    expect(buildTrend(transactions, "2026-09", "2026-10-01")?.categoryChanges).toEqual([
      { category: "food", current: 400, previous: 100, diff: 300 },
      { category: "cafe", current: 100, previous: 300, diff: -200 },
      { category: "delivery", current: -300, previous: -100, diff: -200 },
      { category: "transport", current: 0, previous: 200, diff: -200 },
      { category: "shopping", current: 400, previous: 200, diff: 200 },
      { category: "grocery", current: 50, previous: 0, diff: 50 },
    ]);
  });

  it("uses CATEGORY_IDS order for equally sized positive and negative changes", () => {
    const transactions = [...CATEGORY_IDS].reverse().flatMap((category, index) => [
      transaction({ date: "2026-08-31", category, amount: 201 }),
      transaction({ category, amount: index % 2 === 0 ? 100 : 302 }),
    ]).concat(coverAugustToSeptember());

    expect(buildTrend(transactions, "2026-09", "2026-10-01")?.categoryChanges
      ?.map((change) => change.category)).toEqual(CATEGORY_IDS);
  });

  it("returns an empty categoryChanges list when all category totals are unchanged", () => {
    expect(buildTrend([
      transaction({ date: "2026-08-31" }),
      transaction(),
      ...coverAugustToSeptember(),
    ], "2026-09", "2026-10-01")?.categoryChanges).toEqual([]);
  });

  it("returns identical results for reordered input without mutating transactions", () => {
    const transactions = [
      transaction({ id: "current", amount: 2_003 }),
      transaction({ id: "previous", date: "2026-08-01", amount: 1_001 }),
      transaction({ id: "refund", amount: -101 }),
      transaction({ id: "earliest", date: "2026-07-31", category: "cafe" }),
      transaction({ id: "latest", date: "2026-10-01" }),
    ];
    expect(buildMonthOverMonth(transactions, "2026-09", "2026-10-01")).not.toBeNull();
    const original = transactions.map((item) => ({ ...item }));
    transactions.forEach(Object.freeze);
    Object.freeze(transactions);

    expect(buildMonthOverMonth([...transactions].reverse(), "2026-09", "2026-10-01"))
      .toEqual(buildMonthOverMonth(transactions, "2026-09", "2026-10-01"));
    expect(buildTrend([...transactions].reverse(), "2026-09", "2026-10-01"))
      .toEqual(buildTrend(transactions, "2026-09", "2026-10-01"));
    expect(transactions).toEqual(original);
  });
});
