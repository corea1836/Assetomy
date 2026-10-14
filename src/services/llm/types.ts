import "server-only";
import type { CategoryId } from "@/types/category";
import type { Plan } from "@/types/dashboard";
import type { CardSummaryInput, SummaryContent, SummaryInput } from "@/types/summary";

export type MerchantInput = { merchantKey: string; merchant: string };

export interface MerchantClassifier {
  // Returns every input key; unclassified keys receive etc. Never rejects.
  classify(merchants: MerchantInput[]): Promise<Map<string, CategoryId>>;
}

export type SummaryFailureReason =
  | "request_failed" | "refusal" | "max_tokens" | "invalid_output"
  | "length" | "number" | "forbidden_phrase" | "markup" | "placeholder" | "tip_category";

export type SummaryResult = ({ ok: true } & SummaryContent)
  | { ok: false; reason: SummaryFailureReason };

export interface MonthlySummarizer {
  modelFor(plan: Plan): string;
  // 해시에 넣는 프롬프트(mock은 고정 결과). 바뀌면 저장된 요약을 다시 만든다.
  promptFor(plan: Plan): string;
  // Uses the model for input.plan and never rejects for any failure.
  summarize(input: SummaryInput): Promise<SummaryResult>;
}

export interface CardSummarizer {
  modelFor(plan: Plan): string;
  // 해시에 넣는 프롬프트(mock은 고정 결과). 바뀌면 저장된 카드 요약을 다시 만든다.
  promptFor(plan: Plan): string;
  // Uses the model for input.plan and never rejects for any failure.
  summarize(input: CardSummaryInput): Promise<SummaryResult>;
}
