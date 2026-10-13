import { describe, expect, it } from "vitest";
import { CATEGORY_LABELS } from "@/types/category";
import type { Transaction } from "@/types/transaction";
import { DEMO_TODAY, DEMO_TRANSACTIONS } from "@/lib/demo/fixture";
import { buildDashboard } from "./dashboard";
import { buildSummaryInput } from "./summary-input";

const month = "2026-09";

function getDashboard(plan: "free" | "pro", transactions = DEMO_TRANSACTIONS) {
  const dashboard = buildDashboard({
    transactions,
    plan,
    month,
    today: DEMO_TODAY,
  });
  if (!dashboard) throw new Error("Expected a dashboard");
  return dashboard;
}

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "summary-test-transaction",
    cardId: "summary-test-card",
    cardLabel: "요약 테스트 카드",
    date: "2026-09-15",
    merchant: "요약 테스트 가맹점",
    merchantKey: "summary-test-merchant",
    amount: 10_000,
    category: "food",
    ...overrides,
  };
}

function inputForMonthOverMonth(
  previousAmount: number,
  currentAmount: number,
) {
  const transactions = [
    transaction({ id: "previous", date: "2026-08-15", amount: previousAmount }),
    transaction({ id: "current", date: "2026-09-15", amount: currentAmount }),
  ];
  return buildSummaryInput(getDashboard("free", transactions));
}

const freeKeys = [
  "plan",
  "month",
  "inProgress",
  "period",
  "total",
  "transactionCount",
  "categories",
  "topMerchants",
  "monthOverMonth",
  "candidates",
];

describe("buildSummaryInput", () => {
  it("builds Free input with the fixed key order and no Pro-only fields", () => {
    const dashboard = getDashboard("free");
    if (dashboard.plan !== "free") throw new Error("Expected a Free dashboard");

    const input = buildSummaryInput(dashboard);

    expect(Object.keys(input)).toEqual(freeKeys);
    expect(input).toMatchObject({
      plan: "free",
      month: dashboard.month,
      inProgress: dashboard.snapshot.inProgress,
      period: dashboard.snapshot.period,
      total: dashboard.snapshot.total,
      transactionCount: dashboard.snapshot.transactionCount,
    });
    expect(input).not.toHaveProperty("findings");
    expect(input).not.toHaveProperty("trend");
    expect(input.candidates).toEqual({
      recurring: dashboard.teaser.byKind.recurring,
      duplicate: dashboard.teaser.byKind.duplicate,
      large: dashboard.teaser.byKind.large,
      candidateTotal: dashboard.teaser.candidateTotal,
    });

    const serialized = JSON.stringify(input);
    const proDashboard = getDashboard("pro");
    if (proDashboard.plan !== "pro") throw new Error("Expected a Pro dashboard");
    for (const finding of proDashboard.findings.items) {
      for (const detail of finding.transactions) {
        expect(serialized).not.toContain(detail.id);
      }
    }
    for (const item of DEMO_TRANSACTIONS) {
      expect(serialized).not.toContain(item.cardLabel);
    }
    for (const excludedKey of [
      "findings", "trend", "seriesMonthCount", "merchantKey", "otherMerchants", "daily", "lastDate",
    ]) {
      expect(serialized).not.toContain(`"${excludedKey}"`);
    }
  });

  it("maps Pro findings and trend in DTO order without transaction metadata", () => {
    const dashboard = getDashboard("pro");
    if (dashboard.plan !== "pro") throw new Error("Expected a Pro dashboard");

    const input = buildSummaryInput(dashboard);
    if (input.plan !== "pro") throw new Error("Expected a Pro summary input");

    expect(Object.keys(input)).toEqual([...freeKeys, "findings", "trend"]);
    expect(input.plan).toBe("pro");
    expect(input.findings).toEqual(dashboard.findings.items.map((finding) => ({
      kind: finding.kind,
      merchant: finding.merchant,
      category: CATEGORY_LABELS[finding.category],
      amount: finding.amount,
      transactionCount: finding.transactions.length,
      seriesMonthCount: finding.kind === "recurring" ? finding.seriesMonths.length : null,
    })));
    for (const finding of input.findings) {
      expect(Object.keys(finding)).toEqual([
        "kind", "merchant", "category", "amount", "transactionCount", "seriesMonthCount",
      ]);
    }
    expect(input.trend).toEqual(dashboard.trend && {
      months: dashboard.trend.months.map(({ month: itemMonth, total, inProgress }) => ({
        month: itemMonth,
        total,
        inProgress,
      })),
      categoryChanges: dashboard.trend.categoryChanges?.map((change) => ({
        category: CATEGORY_LABELS[change.category],
        current: change.current,
        previous: change.previous,
        diff: change.diff,
      })) ?? null,
    });

    const serialized = JSON.stringify(input);
    for (const item of DEMO_TRANSACTIONS) {
      expect(serialized).not.toContain(item.id);
      expect(serialized).not.toContain(item.cardLabel);
    }
    expect(serialized).not.toContain("merchantKey");
    expect(serialized).not.toContain("seriesMonths");
    expect(serialized).not.toContain("transactions");
  });

  it("shares the complete common input between Free and Pro", () => {
    const free = buildSummaryInput(getDashboard("free"));
    const pro = buildSummaryInput(getDashboard("pro"));
    if (free.plan !== "free" || pro.plan !== "pro") {
      throw new Error("Expected Free and Pro summary inputs");
    }

    expect({
      month: free.month,
      inProgress: free.inProgress,
      period: free.period,
      total: free.total,
      transactionCount: free.transactionCount,
      categories: free.categories,
      topMerchants: free.topMerchants,
      monthOverMonth: free.monthOverMonth,
      candidates: free.candidates,
    }).toEqual({
      month: pro.month,
      inProgress: pro.inProgress,
      period: pro.period,
      total: pro.total,
      transactionCount: pro.transactionCount,
      categories: pro.categories,
      topMerchants: pro.topMerchants,
      monthOverMonth: pro.monthOverMonth,
      candidates: pro.candidates,
    });
  });

  it("uses Korean category labels and preserves all DTO array order", () => {
    const freeDashboard = getDashboard("free");
    const proDashboard = getDashboard("pro");
    if (freeDashboard.plan !== "free" || proDashboard.plan !== "pro") {
      throw new Error("Expected Free and Pro dashboards");
    }

    const free = buildSummaryInput(freeDashboard);
    const pro = buildSummaryInput(proDashboard);
    if (pro.plan !== "pro") throw new Error("Expected a Pro summary input");

    expect(free.categories.map(({ category }) => category)).toEqual(
      freeDashboard.snapshot.categories.map(({ category }) => CATEGORY_LABELS[category]),
    );
    expect(free.topMerchants.map(({ merchant, category, amount, count }) => ({
      merchant, category, amount, count,
    }))).toEqual(freeDashboard.snapshot.topMerchants.map((item) => ({
      merchant: item.merchant,
      category: CATEGORY_LABELS[item.category],
      amount: item.amount,
      count: item.count,
    })));
    expect(pro.findings.map(({ kind, merchant }) => ({ kind, merchant }))).toEqual(
      proDashboard.findings.items.map(({ kind, merchant }) => ({ kind, merchant })),
    );
    expect(pro.trend?.months.map(({ month: itemMonth }) => itemMonth)).toEqual(
      proDashboard.trend?.months.map(({ month: itemMonth }) => itemMonth),
    );
    expect(free.categories.some(({ category }) => category === CATEGORY_LABELS.subscription))
      .toBe(true);
  });

  it("maps month-over-month differences to directions and keeps null comparisons", () => {
    expect(inputForMonthOverMonth(100, 120).monthOverMonth).toMatchObject({
      diff: 20,
      direction: "up",
    });
    expect(inputForMonthOverMonth(100, 80).monthOverMonth).toMatchObject({
      diff: -20,
      direction: "down",
    });
    expect(inputForMonthOverMonth(100, 100).monthOverMonth).toMatchObject({
      diff: 0,
      direction: "same",
    });

    const singleMonth = [transaction()];
    const free = buildSummaryInput(getDashboard("free", singleMonth));
    const pro = buildSummaryInput(getDashboard("pro", singleMonth));
    expect(free.monthOverMonth).toBeNull();
    if (pro.plan !== "pro") throw new Error("Expected a Pro summary input");
    expect(pro.trend).toBeNull();
  });

  it("preserves the DTO nested key order", () => {
    const free = buildSummaryInput(getDashboard("free"));
    const pro = buildSummaryInput(getDashboard("pro"));

    expect(Object.keys(free.period)).toEqual(["from", "to"]);
    expect(Object.keys(free.categories[0])).toEqual(["category", "amount", "ratio"]);
    expect(Object.keys(free.topMerchants[0])).toEqual(["merchant", "category", "amount", "count"]);
    expect(Object.keys(free.monthOverMonth!)).toEqual([
      "previousMonth", "previousTotal", "diff", "direction",
    ]);
    expect(Object.keys(free.candidates)).toEqual([
      "recurring", "duplicate", "large", "candidateTotal",
    ]);
    if (pro.plan !== "pro" || pro.trend === null) throw new Error("Expected Pro trend data");
    expect(Object.keys(pro.trend)).toEqual(["months", "categoryChanges"]);
    expect(Object.keys(pro.trend.months[0])).toEqual(["month", "total", "inProgress"]);
    expect(Object.keys(pro.trend.categoryChanges![0])).toEqual([
      "category", "current", "previous", "diff",
    ]);
  });

  it("is deterministic for the same DTO and changes when a category changes", () => {
    const first = buildSummaryInput(getDashboard("free"));
    const second = buildSummaryInput(getDashboard("free", [...DEMO_TRANSACTIONS]));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    const changedTransaction = DEMO_TRANSACTIONS.find((item) => item.date.startsWith(`${month}-`));
    if (!changedTransaction) throw new Error("Expected a transaction in the selected month");
    const changedTransactions = DEMO_TRANSACTIONS.map((item): Transaction =>
      item.id === changedTransaction.id
        ? { ...item, category: item.category === "food" ? "shopping" : "food" }
        : item,
    );
    const changed = buildSummaryInput(getDashboard("free", changedTransactions));
    expect(JSON.stringify(changed)).not.toBe(JSON.stringify(first));
  });
});
