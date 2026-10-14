import { CATEGORY_LABELS } from "@/types/category";
import type { CardDashboard, Dashboard, FindingSummary } from "@/types/dashboard";
import type { CardSummaryInput, SummaryCandidates, SummaryInput } from "@/types/summary";

function mapCandidates(summary: FindingSummary): SummaryCandidates {
  return {
    recurring: summary.byKind.recurring,
    duplicate: summary.byKind.duplicate,
    large: summary.byKind.large,
    candidateTotal: summary.candidateTotal,
  };
}

export function buildSummaryInput(dashboard: Dashboard): SummaryInput {
  const { snapshot } = dashboard;
  const shared = {
    month: dashboard.month,
    inProgress: snapshot.inProgress,
    period: snapshot.period,
    total: snapshot.total,
    transactionCount: snapshot.transactionCount,
    categories: snapshot.categories.map(({ category, amount, ratio }) => ({
      category: CATEGORY_LABELS[category],
      amount,
      ratio,
    })),
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

export function buildCardSummaryInput(dashboard: CardDashboard): CardSummaryInput {
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
    categories: snapshot.categories.map(({ category, amount, ratio }) => ({
      category: CATEGORY_LABELS[category],
      amount,
      ratio,
    })),
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
    return { plan: "free", ...shared };
  }

  return {
    plan: "pro",
    ...shared,
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
