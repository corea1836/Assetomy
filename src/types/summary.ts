import type { FindingKind, KindSummary, Period } from "./dashboard";
import type { YearMonth } from "./transaction";

export type SummaryCategory = { category: string; amount: number; ratio: number | null };
export type SummaryMerchant = { merchant: string; category: string; amount: number; count: number };
export type SummaryMonthOverMonth = {
  previousMonth: YearMonth;
  previousTotal: number;
  diff: number;
  direction: "up" | "down" | "same";
};
export type SummaryCandidates = {
  recurring: KindSummary;
  duplicate: KindSummary;
  large: KindSummary;
  candidateTotal: number;
};
type SummaryBase = {
  month: YearMonth;
  inProgress: boolean;
  period: Period;
  total: number;
  transactionCount: number;
  categories: SummaryCategory[];
  topMerchants: SummaryMerchant[];
  monthOverMonth: SummaryMonthOverMonth | null;
  candidates: SummaryCandidates;
};
export type FreeSummaryInput = { plan: "free" } & SummaryBase;
export type SummaryFinding = {
  kind: FindingKind;
  merchant: string;
  category: string;
  amount: number;
  transactionCount: number;
  seriesMonthCount: number | null;
};
export type SummaryTrend = {
  months: { month: YearMonth; total: number; inProgress: boolean }[];
  categoryChanges: { category: string; current: number; previous: number; diff: number }[] | null;
};
export type ProSummaryInput = { plan: "pro" } & SummaryBase & {
  findings: SummaryFinding[];
  trend: SummaryTrend | null;
};
export type SummaryInput = FreeSummaryInput | ProSummaryInput;
