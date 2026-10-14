import { describe, expect, it } from "vitest";
import { CATEGORY_LABELS } from "@/types/category";
import type { StatementRecord } from "@/types/card";
import type { CardOption } from "@/types/upload";
import type { Transaction } from "@/types/transaction";
import { DEMO_TODAY, DEMO_TRANSACTIONS } from "@/lib/demo/fixture";
import { buildCardDashboard, buildDashboard } from "./dashboard";
import { buildCardSummaryInput, buildSummaryInput } from "./summary-input";

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
    statementDate: null,
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
    // 카드 내역이 8·9월을 다 덮어야 전월 비교를 한다.
    transaction({ id: "before", date: "2026-07-31" }),
    transaction({ id: "after", date: "2026-10-01" }),
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
  "partialMonth",
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
      partialMonth: free.partialMonth,
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
      partialMonth: pro.partialMonth,
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

  it("passes the partial month instead of a comparison when a card covers only part of the previous month", () => {
    const transactions = [
      transaction({ id: "first", date: "2026-08-12" }),
      transaction({ id: "current", date: "2026-09-15" }),
      transaction({ id: "last", date: "2026-10-01" }),
    ];
    for (const plan of ["free", "pro"] as const) {
      const input = buildSummaryInput(getDashboard(plan, transactions));
      expect(input.monthOverMonth).toBeNull();
      expect(input.partialMonth).toBe("2026-08");
      if (input.plan === "pro") expect(input.trend?.categoryChanges).toBeNull();
    }
    expect(buildSummaryInput(getDashboard("free")).partialMonth).toBeNull();
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

function summaryCard(analysisBasis: "month" | "cycle"): CardOption {
  return {
    id: "private-card-id",
    label: "비공개 카드 라벨",
    issuer: "hyundai",
    analysisBasis,
    cycleStartDay: analysisBasis === "cycle" ? 12 : null,
  };
}

function buildCardInput(
  plan: "free" | "pro",
  analysisBasis: "month" | "cycle",
  transactions: Transaction[],
  statements: StatementRecord[] = [],
  selection: { month?: string; statement?: string } = {},
) {
  const dashboard = buildCardDashboard({
    card: summaryCard(analysisBasis),
    transactions,
    statements,
    plan,
    ...selection,
    today: "2026-10-14",
  });
  if (!dashboard) throw new Error("Expected a card dashboard");
  return buildCardSummaryInput(dashboard);
}

describe("buildCardSummaryInput", () => {
  it("maps a monthly card comparison and Pro category changes from the card DTO", () => {
    const transactions = [
      transaction({ id: "card-month-previous", cardId: "private-card-id", date: "2026-08-15", amount: 100, category: "food" }),
      transaction({ id: "card-month-current", cardId: "private-card-id", date: "2026-09-15", amount: 130, category: "cafe" }),
      transaction({ id: "card-month-before", cardId: "private-card-id", date: "2026-07-31", amount: 1 }),
      transaction({ id: "card-month-after", cardId: "private-card-id", date: "2026-10-01", amount: 1 }),
    ];
    const free = buildCardInput("free", "month", transactions, [], { month: "2026-09" });
    const pro = buildCardInput("pro", "month", transactions, [], { month: "2026-09" });

    expect(free).toMatchObject({
      plan: "free",
      scope: "month",
      inProgress: false,
      period: { from: "2026-09-15", to: "2026-09-15" },
      total: 130,
      transactionCount: 1,
      comparison: { previousTotal: 100, diff: 30, direction: "up" },
      comparisonSkipped: false,
    });
    expect(free).not.toHaveProperty("categoryChanges");
    if (pro.plan !== "pro") throw new Error("Expected a Pro card summary input");
    expect(pro.categoryChanges).toEqual([
      { category: CATEGORY_LABELS.cafe, current: 130, previous: 0, diff: 130 },
      { category: CATEGORY_LABELS.food, current: 0, previous: 100, diff: -100 },
    ]);
  });

  it("maps statement completion, comparison, and category labels without exposing card or statement identifiers", () => {
    const transactions = [
      transaction({ id: "private-previous-transaction", cardId: "private-card-id", cardLabel: "비공개 카드 라벨", statementDate: "2026-09-23", date: "2026-09-10", amount: 100, category: "food" }),
      transaction({ id: "private-current-transaction", cardId: "private-card-id", cardLabel: "비공개 카드 라벨", statementDate: "2026-10-23", date: "2026-09-20", amount: 130, category: "cafe" }),
    ];
    const statements: StatementRecord[] = [
      { cardId: "private-card-id", statementDate: "2026-09-23", savedOn: "2026-10-14" },
      { cardId: "private-card-id", statementDate: "2026-10-23", savedOn: "2026-10-14" },
    ];
    const free = buildCardInput("free", "cycle", transactions, statements, { statement: "2026-10-23" });
    const pro = buildCardInput("pro", "cycle", transactions, statements, { statement: "2026-10-23" });

    expect(free).toMatchObject({
      plan: "free",
      scope: "statement",
      inProgress: false,
      period: { from: "2026-09-20", to: "2026-09-20" },
      total: 130,
      transactionCount: 1,
      comparison: { previousTotal: 100, diff: 30, direction: "up" },
      comparisonSkipped: false,
    });
    expect(free).not.toHaveProperty("categoryChanges");
    if (pro.plan !== "pro") throw new Error("Expected a Pro card summary input");
    expect(pro.categoryChanges).toEqual([
      { category: CATEGORY_LABELS.cafe, current: 130, previous: 0, diff: 130 },
      { category: CATEGORY_LABELS.food, current: 0, previous: 100, diff: -100 },
    ]);

    const serialized = JSON.stringify(free);
    for (const excluded of [
      "private-card-id", "비공개 카드 라벨", "2026-10-23",
      "private-current-transaction", "private-previous-transaction",
    ]) {
      expect(serialized).not.toContain(excluded);
    }
  });

  it("marks incomplete statement and partial monthly comparisons as skipped", () => {
    const statementTransactions = [
      transaction({ cardId: "private-card-id", statementDate: "2026-09-23", date: "2026-09-10" }),
      transaction({ id: "incomplete-current", cardId: "private-card-id", statementDate: "2026-10-23", date: "2026-09-20" }),
    ];
    const incomplete = buildCardInput("free", "cycle", statementTransactions, [
      { cardId: "private-card-id", statementDate: "2026-09-23", savedOn: "2026-10-14" },
      { cardId: "private-card-id", statementDate: "2026-10-23", savedOn: "2026-10-11" },
    ], { statement: "2026-10-23" });
    const partialMonth = buildCardInput("free", "month", [
      transaction({ cardId: "private-card-id", date: "2026-08-15" }),
      transaction({ id: "partial-current", cardId: "private-card-id", date: "2026-09-15" }),
    ], [], { month: "2026-09" });

    expect(incomplete).toMatchObject({ scope: "statement", inProgress: true, comparison: null, comparisonSkipped: true });
    expect(partialMonth).toMatchObject({ scope: "month", comparison: null, comparisonSkipped: true });
  });
});
