import { describe, expect, it } from "vitest";
import type { StatementRecord } from "@/types/card";
import type { CardOption } from "@/types/upload";
import type { Transaction } from "@/types/transaction";
import { buildMonthOverMonth, buildTrend } from "./comparison";
import { buildCardDashboard, buildDashboard } from "./dashboard";
import { detectFindings } from "./detection";
import { buildSnapshot, listDataMonths } from "./snapshot";
import { datesBetween } from "./dates";
import { DEMO_TODAY, DEMO_TRANSACTIONS } from "@/lib/demo/fixture";

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-id-default",
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

const today = "2026-10-12";
const plans = ["free", "pro"] as const;

const monthlyTransactions: Transaction[] = [
  transaction({ id: "tx-id-september", date: "2026-09-20", amount: 12_001 }),
  transaction({ id: "tx-id-august", date: "2026-08-01", amount: 3_001 }),
  transaction({ id: "tx-id-july-refund", date: "2026-07-01", amount: -5_003 }),
  transaction({ id: "tx-id-august-refund", date: "2026-08-31", amount: -101 }),
  transaction({ id: "tx-id-september-refund", date: "2026-09-30", amount: -2_003 }),
  transaction({
    id: "tx-id-august-other-card",
    cardId: "card-b",
    cardLabel: "다른 카드",
    date: "2026-08-10",
    amount: 4_003,
  }),
  // 전월 비교는 두 달에 거래가 있는 카드마다 두 달을 다 덮어야 한다.
  transaction({ id: "tx-id-july-other-card", cardId: "card-b", cardLabel: "다른 카드", date: "2026-07-01", amount: 1_000 }),
  transaction({ id: "tx-id-september-other-card", cardId: "card-b", cardLabel: "다른 카드", date: "2026-09-30", amount: 1_000 }),
];

const mixedTransactions: Transaction[] = [
  ...Array.from({ length: 20 }, (_, index) => transaction({
    id: `tx-id-ordinary-${index}`,
    date: "2026-08-01",
  })),
  ...["2026-08", "2026-09"].map((month) => transaction({
    id: `tx-id-subscription-${month}`,
    date: `${month}-15`,
    merchant: "정기 서비스",
    merchantKey: "subscription",
    category: "subscription",
    amount: 20_000,
  })),
  ...["a", "b"].map((suffix) => transaction({
    id: `tx-id-duplicate-${suffix}`,
    date: "2026-09-20",
    merchant: "상점",
    merchantKey: "store",
    category: "shopping",
    amount: 10_000,
  })),
  transaction({
    id: "tx-id-large",
    date: "2026-09-25",
    merchant: "숙소",
    merchantKey: "hotel",
    category: "travel",
    amount: 50_000,
  }),
];

describe("buildDashboard", () => {
  it("counts the September demo cancellation pair separately without changing its total (ADR-025)", () => {
    const dashboard = buildDashboard({
      transactions: DEMO_TRANSACTIONS,
      plan: "free",
      month: "2026-09",
      today: DEMO_TODAY,
    });
    if (dashboard?.plan !== "free") throw new Error("Expected a Free dashboard");

    expect(dashboard.snapshot).toMatchObject({
      total: 1_517_200,
      transactionCount: 24,
      cancelCount: 1,
    });
    expect([...dashboard.snapshot.topMerchants, ...dashboard.snapshot.otherMerchants]
      .find(({ merchantKey }) => merchantKey === "demo-shop"))
      .toMatchObject({ count: 1, cancelCount: 1 });
  });

  it.each(plans)("returns null for empty input on the %s plan", (plan) => {
    expect(buildDashboard({ transactions: [], plan, month: "abc", today })).toBeNull();
  });

  it.each(["2026-07", "2026-08", "2026-09"])("selects requested data month %s", (month) => {
    for (const plan of plans) {
      expect(buildDashboard({ transactions: monthlyTransactions, plan, month, today }))
        .toMatchObject({ month, snapshot: { month } });
    }
  });

  it.each([
    undefined, "", "abc", "2026-13", "2026-9", "2026-09-01", "2026-06", "2027-01",
  ])("replaces missing, invalid or absent month %s with the latest data month", (month) => {
    for (const plan of plans) {
      expect(buildDashboard({ transactions: monthlyTransactions, plan, month, today }))
        .toMatchObject({ month: "2026-09", snapshot: { month: "2026-09" } });
    }
  });

  it.each(plans)("builds common fields and keeps the overall last date on the %s plan", (plan) => {
    const dto = buildDashboard({
      transactions: monthlyTransactions, plan, month: "2026-08", today,
    });

    expect(dto).toMatchObject({
      plan,
      month: "2026-08",
      months: [
        { month: "2026-09", period: { from: "2026-09-20", to: "2026-09-30" } },
        { month: "2026-08", period: { from: "2026-08-01", to: "2026-08-31" } },
        { month: "2026-07", period: { from: "2026-07-01", to: "2026-07-01" } },
      ],
      lastDate: "2026-09-30",
      mom: { previousMonth: "2026-07", previousTotal: -4_003, diff: 10_906 },
      partialMonth: null,
    });
    expect(dto?.months).toEqual(listDataMonths(monthlyTransactions));
    expect(dto?.snapshot).toEqual(buildSnapshot(monthlyTransactions, "2026-08", today));
    expect(dto?.mom).toEqual(buildMonthOverMonth(monthlyTransactions, "2026-08", today));
  });

  it.each(["2026-07", "2026-08", "2026-09"])("sums purchases and refunds exactly for %s", (month) => {
    const total = monthlyTransactions
      .filter((item) => item.date.startsWith(`${month}-`))
      .reduce((sum, item) => sum + item.amount, 0);

    for (const plan of plans) {
      const dto = buildDashboard({ transactions: monthlyTransactions, plan, month, today });
      expect(dto?.snapshot.total).toBe(total);
      expect(dto?.snapshot.transactionCount).toBeGreaterThan(0);
    }
  });

  it("keeps findings, transaction ids and trend details out of the serialized Free DTO", () => {
    const dto = buildDashboard({ transactions: mixedTransactions, plan: "free", today });
    if (dto?.plan !== "free") throw new Error("Expected a Free dashboard");

    expect(Object.keys(dto).sort()).toEqual([
      "lastDate", "mom", "month", "months", "partialMonth", "plan", "snapshot", "teaser", "trendAvailable",
    ]);
    expect(Object.keys(dto.teaser).sort()).toEqual(["byKind", "candidateTotal"]);
    expect(dto.teaser).toEqual({
      byKind: {
        recurring: { count: 1, amount: 20_000 },
        duplicate: { count: 1, amount: 20_000 },
        large: { count: 2, amount: 70_000 },
      },
      candidateTotal: 90_000,
    });
    expect(dto.trendAvailable).toBe(true);

    const serialized = JSON.stringify(dto);
    for (const item of mixedTransactions) {
      expect(serialized).not.toContain(item.id);
    }
    for (const key of ["items", "trend", "seriesMonths", "transactions"]) {
      expect(serialized).not.toContain(`"${key}"`);
    }
  });

  it("returns identical aggregate findings for Free and Pro, counting overlapping candidates once", () => {
    const free = buildDashboard({ transactions: mixedTransactions, plan: "free", today });
    const pro = buildDashboard({ transactions: mixedTransactions, plan: "pro", today });
    if (free?.plan !== "free" || pro?.plan !== "pro") {
      throw new Error("Expected Free and Pro dashboards");
    }

    expect(free.teaser.byKind).toEqual(pro.findings.byKind);
    expect(free.teaser.candidateTotal).toBe(pro.findings.candidateTotal);
    expect(pro.findings.candidateTotal).toBe(90_000);
  });

  it("includes detected items and the selected month's trend in the Pro DTO", () => {
    const dto = buildDashboard({ transactions: mixedTransactions, plan: "pro", today });
    if (dto?.plan !== "pro") throw new Error("Expected a Pro dashboard");

    expect(Object.keys(dto).sort()).toEqual([
      "findings", "lastDate", "mom", "month", "months", "partialMonth", "plan", "snapshot", "trend",
    ]);
    expect(Object.keys(dto.findings).sort()).toEqual(["byKind", "candidateTotal", "items"]);
    expect(dto.findings.items).toEqual(detectFindings(mixedTransactions, "2026-09"));
    expect(dto.findings.items.map((item) => item.kind)).toEqual([
      "recurring", "duplicate", "large", "large",
    ]);
    expect(dto.findings.items[0]).toMatchObject({
      seriesMonths: ["2026-08", "2026-09"],
      transactions: [{ id: "tx-id-subscription-2026-09" }],
    });
    expect(dto.trend).toEqual(buildTrend(mixedTransactions, "2026-09", today));
    expect(dto.trend).not.toBeNull();
  });

  it("uses the requested month for findings and trend availability", () => {
    const free = buildDashboard({
      transactions: mixedTransactions, plan: "free", month: "2026-08", today,
    });
    const pro = buildDashboard({
      transactions: mixedTransactions, plan: "pro", month: "2026-08", today,
    });
    if (free?.plan !== "free" || pro?.plan !== "pro") {
      throw new Error("Expected Free and Pro dashboards");
    }

    expect(free.teaser).toEqual({
      byKind: {
        recurring: { count: 1, amount: 20_000 },
        duplicate: { count: 0, amount: 0 },
        large: { count: 1, amount: 20_000 },
      },
      candidateTotal: 20_000,
    });
    expect(pro.findings.items).toEqual(detectFindings(mixedTransactions, "2026-08"));
    expect(pro.trend).toBeNull();
    expect(free.trendAvailable).toBe(false);
  });

  it("returns no trend on either plan when all transactions are in one month", () => {
    const transactions = [
      transaction({ id: "tx-id-first", date: "2026-09-01" }),
      transaction({ id: "tx-id-second", date: "2026-09-30" }),
    ];
    const free = buildDashboard({ transactions, plan: "free", today });
    const pro = buildDashboard({ transactions, plan: "pro", today });
    if (free?.plan !== "free" || pro?.plan !== "pro") {
      throw new Error("Expected Free and Pro dashboards");
    }

    expect(free.trendAvailable).toBe(false);
    expect(pro.trend).toBeNull();
    expect(pro.findings.items).toEqual([]);
    expect(free.teaser).toEqual({
      byKind: {
        recurring: { count: 0, amount: 0 },
        duplicate: { count: 0, amount: 0 },
        large: { count: 0, amount: 0 },
      },
      candidateTotal: 0,
    });
  });

  it.each(plans)("uses the caller's today for progress and comparison on the %s plan", (plan) => {
    const input = { transactions: monthlyTransactions, plan, month: "2026-09" };

    expect(buildDashboard({ ...input, today: "2026-09-30" })).toMatchObject({
      snapshot: { inProgress: true },
      mom: null,
    });
    expect(buildDashboard({ ...input, today: "2026-10-01" })).toMatchObject({
      snapshot: { inProgress: false },
      mom: { previousMonth: "2026-08", previousTotal: 6_903, diff: 4_095 },
      partialMonth: null,
    });
  });

  it.each(plans)("names the partial month instead of comparing on the %s plan", (plan) => {
    const transactions = [
      transaction({ id: "first", date: "2026-08-12" }),
      transaction({ id: "middle", date: "2026-09-15" }),
      transaction({ id: "last", date: "2026-10-11" }),
    ];
    const dto = buildDashboard({ transactions, plan, month: "2026-09", today });

    expect(dto).toMatchObject({ mom: null, partialMonth: "2026-08" });
    if (dto?.plan === "pro") expect(dto.trend?.categoryChanges).toBeNull();
  });

  it.each(plans)("keeps reordered results identical without mutating input on the %s plan", (plan) => {
    const transactions = mixedTransactions.map((item) => ({ ...item }));
    const original = structuredClone(transactions);
    transactions.forEach(Object.freeze);
    Object.freeze(transactions);

    expect(buildDashboard({ transactions: [...transactions].reverse(), plan, today }))
      .toEqual(buildDashboard({ transactions, plan, today }));
    expect(transactions).toEqual(original);
  });
});

function cardOption(overrides: Partial<CardOption> = {}): CardOption {
  return {
    id: "card-a",
    label: "생활비 카드",
    issuer: "hyundai",
    analysisBasis: "month",
    cycleStartDay: null,
    ...overrides,
  };
}

function cardStatementTransactions(
  statementDate: string,
  from: string,
  to: string,
  count: number,
  amount: number,
  category: "food" | "cafe",
  cardId = "card-a",
): Transaction[] {
  const dates = datesBetween(from, to);
  return Array.from({ length: count }, (_, index) => transaction({
    id: `${cardId}-${statementDate}-${index}`,
    cardId,
    cardLabel: cardId === "card-a" ? "생활비 카드" : "다른 카드",
    statementDate,
    date: dates[Math.floor(index * dates.length / count)],
    amount,
    category,
  }));
}

const cycleCard = cardOption({ analysisBasis: "cycle", cycleStartDay: 12 });
const cycleTransactions = [
  ...cardStatementTransactions("2026-09-23", "2026-08-12", "2026-09-12", 109, 1_000, "food"),
  ...cardStatementTransactions("2026-10-23", "2026-09-12", "2026-10-11", 80, 2_000, "cafe"),
  transaction({
    id: "other-card-statement",
    cardId: "card-b",
    cardLabel: "다른 카드",
    statementDate: "2026-10-23",
    date: "2026-10-10",
    amount: 900_000,
  }),
];
const cycleRecords: StatementRecord[] = [
  { cardId: "card-a", statementDate: "2026-09-23", savedOn: "2026-10-14" },
  { cardId: "card-a", statementDate: "2026-10-23", savedOn: "2026-10-14" },
];

describe("buildCardDashboard", () => {
  it("uses only this card for a calendar month and chooses a valid requested month", () => {
    const transactions = [
      transaction({ id: "a-august", cardId: "card-a", date: "2026-08-15", amount: 1_000 }),
      transaction({ id: "a-september", cardId: "card-a", date: "2026-09-15", amount: 2_000 }),
      transaction({ id: "b-august", cardId: "card-b", date: "2026-08-01", amount: 900_000 }),
      transaction({ id: "b-september", cardId: "card-b", date: "2026-09-30", amount: 900_000 }),
    ];

    const selected = buildCardDashboard({
      card: cardOption(), transactions, statements: [], plan: "free", month: "2026-08", today: "2026-10-14",
    });
    const fallback = buildCardDashboard({
      card: cardOption(), transactions, statements: [], plan: "free", month: "not-a-month", today: "2026-10-14",
    });

    expect(selected).toMatchObject({
      basis: "month",
      month: "2026-08",
      snapshot: { total: 1_000, transactionCount: 1 },
      mom: null,
      partialMonth: null,
    });
    expect(fallback).toMatchObject({
      basis: "month",
      month: "2026-09",
      snapshot: { total: 2_000, transactionCount: 1 },
      lastDate: "2026-09-15",
    });
  });

  it("compares only this card's monthly coverage and gives Pro category changes only with a comparison", () => {
    const partialTransactions = [
      transaction({ id: "a-august", cardId: "card-a", date: "2026-08-15", amount: 1_000, category: "food" }),
      transaction({ id: "a-september", cardId: "card-a", date: "2026-09-15", amount: 2_000, category: "cafe" }),
      transaction({ id: "b-before", cardId: "card-b", date: "2026-07-31" }),
      transaction({ id: "b-after", cardId: "card-b", date: "2026-10-01" }),
    ];
    const partial = buildCardDashboard({
      card: cardOption(), transactions: partialTransactions, statements: [], plan: "pro", month: "2026-09", today: "2026-10-14",
    });
    const covered = buildCardDashboard({
      card: cardOption(),
      transactions: [
        ...partialTransactions,
        transaction({ id: "a-before", date: "2026-07-31", amount: 1 }),
        transaction({ id: "a-after", date: "2026-10-01", amount: 1 }),
      ],
      statements: [], plan: "pro", month: "2026-09", today: "2026-10-14",
    });

    expect(partial).toMatchObject({ mom: null, partialMonth: "2026-08", categoryChanges: null });
    expect(covered).toMatchObject({
      mom: { previousMonth: "2026-08", previousTotal: 1_000, diff: 1_000 },
      partialMonth: null,
      categoryChanges: [
        { category: "cafe", current: 2_000, previous: 0, diff: 2_000 },
        { category: "food", current: 0, previous: 1_000, diff: -1_000 },
      ],
    });
  });

  it("builds the October statement view from its statementDate rows and compares with the prior completed statement", () => {
    const result = buildCardDashboard({
      card: cycleCard,
      transactions: cycleTransactions,
      statements: cycleRecords,
      plan: "pro",
      statement: "2026-10-23",
      today: "2026-10-14",
    });

    expect(result).toMatchObject({
      basis: "cycle",
      statementDate: "2026-10-23",
      statements: [
        { statementDate: "2026-10-23", cyclePeriod: { from: "2026-09-12", to: "2026-10-11" } },
        { statementDate: "2026-09-23", cyclePeriod: { from: "2026-08-12", to: "2026-09-11" } },
      ],
      cyclePeriod: { from: "2026-09-12", to: "2026-10-11" },
      complete: true,
      snapshot: {
        period: { from: "2026-09-12", to: "2026-10-11" },
        total: 160_000,
        transactionCount: 80,
      },
      comparison: { previousStatementDate: "2026-09-23", previousTotal: 109_000, diff: 51_000 },
      comparisonSkipped: false,
      categoryChanges: [
        { category: "cafe", current: 160_000, previous: 0, diff: 160_000 },
        { category: "food", current: 0, previous: 109_000, diff: -109_000 },
      ],
    });
    expect(result?.snapshot.daily[0].date).toBe("2026-09-12");
    expect(result?.snapshot.daily.at(-1)?.date).toBe("2026-10-11");
  });

  it("keeps the September statement's September 12 annual-fee date beyond the displayed cycle end", () => {
    const result = buildCardDashboard({
      card: cycleCard, transactions: cycleTransactions, statements: cycleRecords,
      plan: "free", statement: "2026-09-23", today: "2026-10-14",
    });

    expect(result).toMatchObject({
      basis: "cycle",
      statementDate: "2026-09-23",
      cyclePeriod: { from: "2026-08-12", to: "2026-09-11" },
      complete: true,
      snapshot: {
        period: { from: "2026-08-12", to: "2026-09-12" },
        total: 109_000,
        transactionCount: 109,
      },
      comparison: null,
      comparisonSkipped: false,
    });
    expect(result?.snapshot.daily.at(-1)?.date).toBe("2026-09-12");
    expect(result && "categoryChanges" in result).toBe(false);
  });

  it.each([
    ["selected statement saved on cycle end", false, [{ cardId: "card-a", statementDate: "2026-09-23", savedOn: "2026-10-14" }, { cardId: "card-a", statementDate: "2026-10-23", savedOn: "2026-10-11" }]],
    ["previous statement saved on cycle end", true, [{ cardId: "card-a", statementDate: "2026-09-23", savedOn: "2026-09-11" }, { cardId: "card-a", statementDate: "2026-10-23", savedOn: "2026-10-14" }]],
    ["selected statement has no record", false, [
      { cardId: "card-a", statementDate: "2026-09-23", savedOn: "2026-10-14" },
      { cardId: "card-b", statementDate: "2026-10-23", savedOn: "2026-10-14" },
    ]],
  ] as const)("skips comparison when %s", (_label, complete, statements) => {
    const result = buildCardDashboard({
      card: cycleCard, transactions: cycleTransactions, statements: [...statements], plan: "pro",
      statement: "2026-10-23", today: "2026-10-14",
    });

    expect(result).toMatchObject({ complete, comparison: null, comparisonSkipped: true, categoryChanges: null });
  });

  it("does not compare statements when the immediately previous payment month is missing", () => {
    const transactions = [
      ...cardStatementTransactions("2026-08-23", "2026-07-12", "2026-08-11", 2, 1_000, "food"),
      ...cardStatementTransactions("2026-10-23", "2026-09-12", "2026-10-11", 2, 2_000, "cafe"),
    ];
    const result = buildCardDashboard({
      card: cycleCard, transactions,
      statements: [
        { cardId: "card-a", statementDate: "2026-08-23", savedOn: "2026-08-12" },
        { cardId: "card-a", statementDate: "2026-10-23", savedOn: "2026-10-14" },
      ],
      plan: "pro", today: "2026-10-14",
    });

    expect(result).toMatchObject({ statementDate: "2026-10-23", comparison: null, comparisonSkipped: false, categoryChanges: null });
  });

  it("falls back to the newest statement and returns null when only undated transactions exist", () => {
    const latest = buildCardDashboard({
      card: cycleCard, transactions: cycleTransactions, statements: cycleRecords,
      plan: "free", statement: "2026-07-01", today: "2026-10-14",
    });
    const undated = buildCardDashboard({
      card: cycleCard,
      transactions: [transaction({ statementDate: null })],
      statements: cycleRecords,
      plan: "pro", today: "2026-10-14",
    });

    expect(latest).toMatchObject({ statementDate: "2026-10-23" });
    expect(undated).toBeNull();
  });

  it("throws when a cycle card has no cycle start day", () => {
    expect(() => buildCardDashboard({
      card: cardOption({ analysisBasis: "cycle", cycleStartDay: null }),
      transactions: [],
      statements: [],
      plan: "free",
      today: "2026-10-14",
    })).toThrow("Cycle card is missing its cycle start day");
  });
});
