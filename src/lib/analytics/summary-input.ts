import { CATEGORY_LABELS } from "@/types/category";
import type { CardDashboard, CardFlow, Dashboard, FindingSummary, PeriodSnapshot } from "@/types/dashboard";
import type {
  CardSummaryInput, SummaryCandidates, SummaryFeedback, SummaryFlow, SummaryInput,
} from "@/types/summary";

function mapCandidates(summary: FindingSummary): SummaryCandidates {
  return {
    recurring: summary.byKind.recurring,
    duplicate: summary.byKind.duplicate,
    large: summary.byKind.large,
    candidateTotal: summary.candidateTotal,
  };
}

function mapCategories(snapshot: PeriodSnapshot, feedback: SummaryFeedback) {
  const merchants = [...snapshot.topMerchants, ...snapshot.otherMerchants];
  return snapshot.categories.map(({ category, amount, ratio }) => {
    const topMerchant = merchants.find((merchant) => merchant.category === category && merchant.amount > 0);
    return {
      category: CATEGORY_LABELS[category],
      amount,
      ratio,
      topMerchant: topMerchant === undefined
        ? null
        : { merchant: topMerchant.merchant, amount: topMerchant.amount, count: topMerchant.count },
      feedback: feedback[category] ?? null,
    };
  });
}

function mapFlow(flow: CardFlow | null): SummaryFlow | null {
  return flow === null
    ? null
    : {
      direction: flow.direction,
      periods: flow.periods.map(({ month, total }) => ({ month, total })),
    };
}

export function buildSummaryInput(dashboard: Dashboard, feedback: SummaryFeedback): SummaryInput {
  const { snapshot } = dashboard;
  const shared = {
    month: dashboard.month,
    inProgress: snapshot.inProgress,
    period: snapshot.period,
    total: snapshot.total,
    transactionCount: snapshot.transactionCount,
    categories: mapCategories(snapshot, feedback),
    topMerchants: snapshot.topMerchants.map(({ merchant, category, amount, count }) => ({
      merchant,
      category: CATEGORY_LABELS[category],
      amount,
      count,
    })),
    monthOverMonth: dashboard.mom === null
      ? null
      : {
        previousMonth: dashboard.mom.previousMonth,
        previousTotal: dashboard.mom.previousTotal,
        diff: dashboard.mom.diff,
        direction: dashboard.mom.diff > 0
          ? "up" as const
          : dashboard.mom.diff < 0
            ? "down" as const
            : "same" as const,
      },
    partialMonth: dashboard.partialMonth,
  };

  if (dashboard.plan === "free") {
    return {
      plan: "free",
      ...shared,
      candidates: mapCandidates(dashboard.teaser),
    };
  }

  return {
    plan: "pro",
    ...shared,
    candidates: mapCandidates(dashboard.findings),
    findings: dashboard.findings.items.map((finding) => ({
      kind: finding.kind,
      merchant: finding.merchant,
      category: CATEGORY_LABELS[finding.category],
      amount: finding.amount,
      transactionCount: finding.transactions.length,
      seriesMonthCount: finding.kind === "recurring" ? finding.seriesMonths.length : null,
    })),
    trend: dashboard.trend === null
      ? null
      : {
        months: dashboard.trend.months.map(({ month, total, inProgress }) => ({
          month,
          total,
          inProgress,
        })),
        categoryChanges: dashboard.trend.categoryChanges === null
          ? null
          : dashboard.trend.categoryChanges.map(({ category, current, previous, diff }) => ({
            category: CATEGORY_LABELS[category],
            current,
            previous,
            diff,
          })),
      },
  };
}

export function buildCardSummaryInput(dashboard: CardDashboard, feedback: SummaryFeedback): CardSummaryInput {
  const { snapshot } = dashboard;
  const comparison = dashboard.basis === "month"
    ? dashboard.mom === null
      ? null
      : {
        previousTotal: dashboard.mom.previousTotal,
        diff: dashboard.mom.diff,
        direction: dashboard.mom.diff > 0
          ? "up" as const
          : dashboard.mom.diff < 0
            ? "down" as const
            : "same" as const,
      }
    : dashboard.comparison === null
      ? null
      : {
        previousTotal: dashboard.comparison.previousTotal,
        diff: dashboard.comparison.diff,
        direction: dashboard.comparison.diff > 0
          ? "up" as const
          : dashboard.comparison.diff < 0
            ? "down" as const
            : "same" as const,
      };
  const shared = {
    scope: dashboard.basis === "month" ? "month" as const : "statement" as const,
    period: snapshot.period,
    inProgress: dashboard.basis === "month" ? dashboard.snapshot.inProgress : !dashboard.complete,
    total: snapshot.total,
    transactionCount: snapshot.transactionCount,
    categories: mapCategories(snapshot, feedback),
    topMerchants: snapshot.topMerchants.map(({ merchant, category, amount, count }) => ({
      merchant,
      category: CATEGORY_LABELS[category],
      amount,
      count,
    })),
    comparison,
    comparisonSkipped: dashboard.basis === "month"
      ? dashboard.partialMonth !== null
      : dashboard.comparisonSkipped,
  };

  if (dashboard.plan === "free") {
    return { plan: "free", ...shared, flow: mapFlow(dashboard.flow) };
  }

  const flow = dashboard.flow;
  return {
    plan: "pro",
    ...shared,
    flow: flow === null
      ? null
      : {
        direction: flow.direction,
        periods: flow.periods.map(({ month, total }) => ({ month, total })),
        categories: flow.categories.map(({ category, direction, amounts }) => ({
          category: CATEGORY_LABELS[category],
          direction,
          periods: flow.periods.map(({ month }, index) => ({ month, amount: amounts[index] })),
        })),
      },
    categoryChanges: dashboard.categoryChanges === null
      ? null
      : dashboard.categoryChanges.map(({ category, current, previous, diff }) => ({
        category: CATEGORY_LABELS[category],
        current,
        previous,
        diff,
      })),
  };
}
