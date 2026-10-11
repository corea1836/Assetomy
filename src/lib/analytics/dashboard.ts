import type { Dashboard, Plan } from "@/types/dashboard";
import type { IsoDate, Transaction } from "@/types/transaction";
import { buildMonthOverMonth, buildTrend } from "./comparison";
import { detectFindings, summarizeFindings } from "./detection";
import { buildSnapshot, listDataMonths } from "./snapshot";

export type BuildDashboardInput = {
  transactions: Transaction[];
  plan: Plan;
  month?: string;
  today: IsoDate;
};

export function buildDashboard(input: BuildDashboardInput): Dashboard | null {
  const { transactions, plan, month: requestedMonth, today } = input;
  if (transactions.length === 0) return null;

  const months = listDataMonths(transactions);
  const month = months.find((option) => option.month === requestedMonth)?.month
    ?? months[0].month;
  const common = {
    month,
    months,
    lastDate: months[0].period.to,
    snapshot: buildSnapshot(transactions, month, today),
    mom: buildMonthOverMonth(transactions, month, today),
  };
  const items = detectFindings(transactions, month);
  const { byKind, candidateTotal } = summarizeFindings(items);
  const trend = buildTrend(transactions, month, today);

  if (plan === "free") {
    // RSC payload에 탐지 상세나 추세가 섞이지 않도록 허용된 필드만 만든다.
    return {
      ...common,
      plan: "free",
      teaser: { byKind, candidateTotal },
      trendAvailable: trend !== null,
    };
  }

  return {
    ...common,
    plan: "pro",
    findings: { byKind, candidateTotal, items },
    trend,
  };
}
