import { describe, expect, it } from "vitest";
import type { Transaction } from "@/types/transaction";
import { buildMonthOverMonth, buildTrend } from "./comparison";
import { buildDashboard } from "./dashboard";
import { detectFindings } from "./detection";
import { buildSnapshot, listDataMonths } from "./snapshot";

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-id-default",
    cardId: "card-a",
    cardLabel: "생활비 카드",
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
