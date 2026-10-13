import { CATEGORY_LABELS } from "@/types/category";
import type { Dashboard, FindingSummary } from "@/types/dashboard";
import type { SummaryCandidates, SummaryInput } from "@/types/summary";

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
