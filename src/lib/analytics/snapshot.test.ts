import { describe, expect, it } from "vitest";
import { CATEGORY_IDS } from "@/types/category";
import type { Transaction } from "@/types/transaction";
import { DEMO_TODAY, DEMO_TRANSACTIONS } from "@/lib/demo/fixture";
import { buildSnapshot, listDataMonths, TOP_MERCHANT_LIMIT } from "./snapshot";

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

const monthlyTransactions: Transaction[] = [
  transaction({ id: "refund", date: "2026-09-18", amount: -3_001 }),
  transaction({
    id: "cafe",
    date: "2026-09-30",
    merchant: "카페",
    merchantKey: "cafe",
    amount: 4_003,
    category: "cafe",
  }),
  transaction({ id: "purchase-a", date: "2026-09-03", amount: 12_001 }),
  transaction({
    id: "previous-month",
    date: "2026-08-31",
    amount: 900_000,
  }),
  transaction({
    id: "purchase-b",
    cardId: "card-b",
    cardLabel: "다른 카드",
    date: "2026-09-03",
    amount: 12_001,
  }),
  transaction({
    id: "grocery",
    merchant: "마트",
    merchantKey: "grocery",
    amount: 8_009,
    category: "grocery",
  }),
  transaction({
    id: "next-month",
    date: "2026-10-01",
    merchant: "다음 달 표시명",
    amount: 800_000,
    category: "etc",
  }),
];

describe("listDataMonths", () => {
  it("returns an empty list when there are no transactions", () => {
    expect(listDataMonths([])).toEqual([]);
  });

  it("lists only months with transactions, newest first, with actual periods", () => {
    const transactions = [
      transaction({ id: "july-late", date: "2026-07-20", amount: -1_000 }),
      transaction({ id: "december", date: "2025-12-31" }),
      transaction({ id: "september-late", date: "2026-09-30" }),
      transaction({ id: "july-early", date: "2026-07-02", amount: 1_000 }),
      transaction({ id: "september-early", date: "2026-09-05" }),
      transaction({ id: "zero", date: "2026-05-10", amount: 0 }),
    ];

    expect(listDataMonths(transactions)).toEqual([
      { month: "2026-09", period: { from: "2026-09-05", to: "2026-09-30" } },
      { month: "2026-07", period: { from: "2026-07-02", to: "2026-07-20" } },
      { month: "2026-05", period: { from: "2026-05-10", to: "2026-05-10" } },
      { month: "2025-12", period: { from: "2025-12-31", to: "2025-12-31" } },
    ]);
    expect(listDataMonths([...transactions].reverse())).toEqual(
      listDataMonths(transactions),
    );
  });
});

describe("buildSnapshot", () => {
  it("counts identical purchases on two different cards separately", () => {
    const snapshot = buildSnapshot(
      [
        transaction({ id: "purchase-a", amount: 12_001 }),
        transaction({ id: "purchase-b", cardId: "card-b", amount: 12_001 }),
      ],
      "2026-09",
      "2026-10-01",
    );

    expect(snapshot.total).toBe(24_002);
    expect(snapshot.transactionCount).toBe(2);
    expect(snapshot.topMerchants[0]).toMatchObject({ amount: 24_002, count: 2 });
  });

  it("subtracts refunds from the total, categories, merchants and daily amounts", () => {
    const snapshot = buildSnapshot(monthlyTransactions, "2026-09", "2026-10-01");

    expect(snapshot.total).toBe(33_013);
    expect(snapshot.categories).toEqual([
      { category: "food", amount: 21_001, ratio: 21_001 / 33_013 },
      { category: "grocery", amount: 8_009, ratio: 8_009 / 33_013 },
      { category: "cafe", amount: 4_003, ratio: 4_003 / 33_013 },
    ]);
    expect(snapshot.topMerchants[0]).toEqual({
      merchantKey: "restaurant",
      merchant: "식당",
      category: "food",
      amount: 21_001,
      count: 3,
    });
    expect(snapshot.daily[2]).toEqual({ date: "2026-09-03", amount: 24_002 });
    expect(snapshot.daily[17]).toEqual({ date: "2026-09-18", amount: -3_001 });
  });

  it("uses only the selected month's transactions and actual period", () => {
    const snapshot = buildSnapshot(monthlyTransactions, "2026-09", "2026-10-01");

    expect(snapshot).toMatchObject({
      month: "2026-09",
      total: 33_013,
      transactionCount: 5,
      period: { from: "2026-09-03", to: "2026-09-30" },
    });
    expect(snapshot).toEqual(
      buildSnapshot(
        monthlyTransactions.filter((item) => item.date.startsWith("2026-09-")),
        "2026-09",
        "2026-10-01",
      ),
    );
  });

  it("keeps category and daily sums equal to the total without rounding", () => {
    const snapshot = buildSnapshot(monthlyTransactions, "2026-09", "2026-10-01");

    expect(snapshot.categories.reduce((sum, item) => sum + item.amount, 0)).toBe(
      snapshot.total,
    );
    expect(snapshot.daily.reduce((sum, item) => sum + item.amount, 0)).toBe(
      snapshot.total,
    );
    expect(Number.isSafeInteger(snapshot.total)).toBe(true);
    expect(snapshot.categories.every((item) => Number.isSafeInteger(item.amount))).toBe(true);
    expect(snapshot.daily.every((item) => Number.isSafeInteger(item.amount))).toBe(true);
  });

  it.each([
    ["2026-08-31", true],
    ["2026-09-01", true],
    ["2026-09-30", true],
    ["2026-10-01", false],
  ] as const)("sets inProgress relative to %s", (today, expected) => {
    expect(buildSnapshot(monthlyTransactions, "2026-09", today).inProgress).toBe(
      expected,
    );
  });

  it("sorts tied category amounts in CATEGORY_IDS order", () => {
    const transactions = [...CATEGORY_IDS].reverse().map((category) =>
      transaction({ id: category, category, amount: 101 }),
    );
    const snapshot = buildSnapshot(transactions, "2026-09", "2026-10-01");

    expect(snapshot.categories.map((item) => item.category)).toEqual(CATEGORY_IDS);
  });

  it("excludes zero category sums but keeps negative sums and signed ratios", () => {
    const transactions = [
      transaction({ id: "food", amount: 5_003 }),
      transaction({ id: "cafe-purchase", category: "cafe", amount: 101 }),
      transaction({ id: "cafe-refund", category: "cafe", amount: -101 }),
      transaction({ id: "grocery-refund", category: "grocery", amount: -3_001 }),
    ];
    const snapshot = buildSnapshot(transactions, "2026-09", "2026-10-01");

    expect(snapshot.total).toBe(2_002);
    expect(snapshot.categories).toEqual([
      { category: "food", amount: 5_003, ratio: 5_003 / 2_002 },
      { category: "grocery", amount: -3_001, ratio: -3_001 / 2_002 },
    ]);
    expect(snapshot.categories.reduce((sum, item) => sum + item.amount, 0)).toBe(2_002);
  });

  it.each([
    [-1_001, 0],
    [-2_003, -1_002],
  ])("uses null ratios when refunds are %i and total is %i", (refund, total) => {
    const snapshot = buildSnapshot(
      [
        transaction({ id: "purchase", amount: 1_001 }),
        transaction({ id: "refund", category: "cafe", amount: refund }),
      ],
      "2026-09",
      "2026-10-01",
    );

    expect(snapshot.total).toBe(total);
    expect(snapshot.categories).toEqual([
      { category: "food", amount: 1_001, ratio: null },
      { category: "cafe", amount: refund, ratio: null },
    ]);
    expect(snapshot.categories.reduce((sum, item) => sum + item.amount, 0)).toBe(total);
    expect(snapshot.daily.reduce((sum, item) => sum + item.amount, 0)).toBe(total);
  });

  it("returns at most five positive merchant sums, with keys breaking amount ties", () => {
    const transactions = ["f", "d", "b", "e", "c", "a"].map((merchantKey) =>
      transaction({ id: merchantKey, merchantKey, amount: 1_001 }),
    );
    transactions.push(
      transaction({ id: "highest", merchantKey: "z", amount: 2_003 }),
      transaction({ id: "zero-purchase", merchantKey: "zero", amount: 4_000 }),
      transaction({ id: "zero-refund", merchantKey: "zero", amount: -4_000 }),
      transaction({ id: "negative", merchantKey: "negative", amount: -5_001 }),
    );
    const snapshot = buildSnapshot(transactions, "2026-09", "2026-10-01");

    expect(TOP_MERCHANT_LIMIT).toBe(5);
    expect(snapshot.topMerchants).toHaveLength(TOP_MERCHANT_LIMIT);
    expect(snapshot.topMerchants.map((item) => item.merchantKey)).toEqual([
      "z", "a", "b", "c", "d",
    ]);
    expect(snapshot.topMerchants.map((item) => item.amount)).toEqual([
      2_003, 1_001, 1_001, 1_001, 1_001,
    ]);
  });

  it("uses the latest merchant details, breaking same-day ties by the greatest id", () => {
    const transactions = [
      transaction({ id: "z-old", date: "2026-09-01", merchant: "이전 표시명" }),
      transaction({
        id: "b-latest",
        date: "2026-09-20",
        merchant: "최신 표시명",
        category: "grocery",
        amount: -101,
      }),
      transaction({
        id: "a-latest",
        date: "2026-09-20",
        merchant: "동일 날짜의 다른 표시명",
        category: "cafe",
        amount: 1_003,
      }),
    ];
    const snapshot = buildSnapshot(transactions, "2026-09", "2026-10-01");

    expect(snapshot.topMerchants).toEqual([
      {
        merchantKey: "restaurant",
        merchant: "최신 표시명",
        category: "grocery",
        amount: 1_902,
        count: 3,
      },
    ]);
    expect(buildSnapshot([...transactions].reverse(), "2026-09", "2026-10-01"))
      .toEqual(snapshot);
  });

  it("partitions every monthly merchant once, retaining zero and refund-only sums in order", () => {
    const transactions = ["f", "d", "b", "e", "c", "a"].map((merchantKey) =>
      transaction({ id: merchantKey, merchantKey, amount: 1_001 }),
    );
    transactions.push(
      transaction({ id: "zero-purchase", merchantKey: "zero", amount: 4_000 }),
      transaction({ id: "zero-refund", merchantKey: "zero", amount: -4_000 }),
      transaction({ id: "refund-old", merchantKey: "refund", amount: -5_001 }),
      transaction({ id: "refund-latest-a", merchantKey: "refund", date: "2026-09-20", merchant: "같은 날 이전 이름", category: "cafe", amount: -100 }),
      transaction({ id: "refund-latest-b", merchantKey: "refund", date: "2026-09-20", merchant: "최신 환불 가맹점", category: "shopping", amount: -200 }),
      transaction({ id: "outside", merchantKey: "outside", date: "2026-08-31" }),
    );
    const snapshot = buildSnapshot(transactions, "2026-09", "2026-10-01");
    const all = [...snapshot.topMerchants, ...snapshot.otherMerchants];
    expect(all.map(({ merchantKey }) => merchantKey).sort()).toEqual(
      [...new Set(transactions.filter(({ date }) => date.startsWith("2026-09-")).map(({ merchantKey }) => merchantKey))].sort(),
    );
    expect(snapshot.otherMerchants).toEqual([
      { merchantKey: "f", merchant: "식당", category: "food", amount: 1_001, count: 1 },
      { merchantKey: "zero", merchant: "식당", category: "food", amount: 0, count: 2 },
      { merchantKey: "refund", merchant: "최신 환불 가맹점", category: "shopping", amount: -5_301, count: 3 },
    ]);
    expect(buildSnapshot([...transactions].reverse(), "2026-09", "2026-10-01")).toEqual(snapshot);
  });

  it("sorts other merchants with equal amounts by merchantKey", () => {
    const transactions = ["h", "g", "f", "e", "d", "c", "b", "a"].map((merchantKey) =>
      transaction({ id: merchantKey, merchantKey, amount: 100 }),
    );
    expect(buildSnapshot(transactions, "2026-09", "2026-10-01").otherMerchants.map(({ merchantKey }) => merchantKey))
      .toEqual(["f", "g", "h"]);
  });

  it("has seven other merchants in the September demo, starting with telecom", () => {
    const snapshot = buildSnapshot(DEMO_TRANSACTIONS, "2026-09", DEMO_TODAY);
    expect(snapshot.otherMerchants).toHaveLength(7);
    expect(snapshot.otherMerchants[0]).toEqual({
      merchantKey: "demo-telecom", merchant: "예시 구름선 통신", category: "housing", amount: 55_000, count: 1,
    });
  });

  it.each([
    ["2026-02", 28],
    ["2024-02", 29],
    ["2026-09", 30],
    ["2026-12", 31],
  ] as const)("lists every date in %s (%i days), including days without transactions", (month, count) => {
    const snapshot = buildSnapshot(
      [transaction({ date: `${month}-15`, amount: 1_001 })],
      month,
      "2027-01-01",
    );

    expect(snapshot.daily).toEqual(
      Array.from({ length: count }, (_, index) => ({
        date: `${month}-${String(index + 1).padStart(2, "0")}`,
        amount: index === 14 ? 1_001 : 0,
      })),
    );
    expect(snapshot.daily).toHaveLength(count);
    expect(snapshot.period).toEqual({ from: `${month}-15`, to: `${month}-15` });
  });

  it("retains the period and count when all category and merchant sums are zero", () => {
    const snapshot = buildSnapshot(
      [
        transaction({ id: "purchase", date: "2026-09-04", amount: 1_001 }),
        transaction({ id: "refund", date: "2026-09-25", amount: -1_001 }),
      ],
      "2026-09",
      "2026-10-01",
    );

    expect(snapshot).toMatchObject({
      total: 0,
      transactionCount: 2,
      period: { from: "2026-09-04", to: "2026-09-25" },
      categories: [],
      topMerchants: [],
    });
    expect(snapshot.daily.reduce((sum, item) => sum + item.amount, 0)).toBe(0);
  });

  it("throws when the selected month has no transactions", () => {
    expect(() => buildSnapshot([], "2026-09", "2026-10-01")).toThrow();
    expect(() => buildSnapshot(monthlyTransactions, "2026-07", "2026-10-01"))
      .toThrow();
  });

  it("returns identical results for reordered input without mutating transactions", () => {
    const transactions = monthlyTransactions.map((item) => ({ ...item }));
    const original = monthlyTransactions.map((item) => ({ ...item }));
    const expected = buildSnapshot(transactions, "2026-09", "2026-10-01");
    const orders = [
      [...transactions].reverse(),
      [...transactions.slice(3), ...transactions.slice(0, 3)],
      [...transactions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    ];

    for (const reordered of orders) {
      expect(buildSnapshot(reordered, "2026-09", "2026-10-01")).toEqual(expected);
      expect(listDataMonths(reordered)).toEqual(listDataMonths(transactions));
    }
    expect(transactions).toEqual(original);
  });
});
