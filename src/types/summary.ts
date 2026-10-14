import type { FindingKind, KindSummary, Period, Plan } from "./dashboard";
import type { CategoryId } from "./category";
import type { YearMonth } from "./transaction";

export const SUMMARY_FEEDBACK_MAX_LENGTH = 100;
export type SummaryFeedback = Partial<Record<CategoryId, string>>;
export type SummaryFeedbackRequest = { category: CategoryId; text: string };
export type SummaryFeedbackResponse = { saved: true } | { deleted: true };
export type SaveSummaryFeedbackResult = { kind: "saved" | "deleted" };

// LLM structured output: each tip names one category from the summary input.
export type SummaryDraft = {
  summary: string;
  comparison: string;
  tips: { category: string; text: string }[];
};
// Validated content stored and returned to the existing summary sections.
export type SummaryContent = { summary: string; tips: string[]; tipCategories: CategoryId[] };
export type StoredSummary = { inputHash: string } & SummaryContent;
export type SaveSummaryInput = {
  userId: string;
  month: YearMonth;
  plan: Plan;
  model: string;
  inputHash: string;
  summary: string;
  tips: string[];
  tipCategories: CategoryId[];
};
export type SaveSummaryResult = { kind: "saved" | "no_transactions" };
export type SaveCardSummaryInput = {
  userId: string;
  cardId: string;
  period: string; // 'YYYY-MM' 또는 결제일 'YYYY-MM-DD'
  plan: Plan;
  model: string;
  inputHash: string;
  summary: string;
  tips: string[];
  tipCategories: CategoryId[];
};
export type SaveCardSummaryResult = {
  kind: "saved" | "card_not_found" | "basis_mismatch" | "no_data";
};
export type MonthlySummaryView = ({ kind: "ready" } & SummaryContent) | { kind: "failed" };

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
  partialMonth: YearMonth | null;
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

export type CardSummaryComparison = {
  previousTotal: number;
  diff: number;
  direction: "up" | "down" | "same";
};
type CardSummaryBase = {
  scope: "month" | "statement";
  period: Period;
  inProgress: boolean;
  total: number;
  transactionCount: number;
  categories: SummaryCategory[];
  topMerchants: SummaryMerchant[];
  comparison: CardSummaryComparison | null;
  comparisonSkipped: boolean;
};
export type FreeCardSummaryInput = { plan: "free" } & CardSummaryBase;
export type ProCardSummaryInput = { plan: "pro" } & CardSummaryBase & {
  categoryChanges: { category: string; current: number; previous: number; diff: number }[] | null;
};
export type CardSummaryInput = FreeCardSummaryInput | ProCardSummaryInput;
