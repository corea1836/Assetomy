import "server-only";
import type { CategoryId } from "@/types/category";
import type { Plan } from "@/types/dashboard";
import type { SummaryInput } from "@/types/summary";

export type MerchantInput = { merchantKey: string; merchant: string };

export interface MerchantClassifier {
  // Returns every input key; unclassified keys receive etc. Never rejects.
  classify(merchants: MerchantInput[]): Promise<Map<string, CategoryId>>;
}

export type SummaryFailureReason =
  | "request_failed" | "refusal" | "max_tokens" | "invalid_output"
  | "length" | "number" | "forbidden_phrase" | "markup";

export type SummaryResult = { ok: true; text: string }
  | { ok: false; reason: SummaryFailureReason };

export interface MonthlySummarizer {
  modelFor(plan: Plan): string;
  // Uses the model for input.plan and never rejects for any failure.
  summarize(input: SummaryInput): Promise<SummaryResult>;
}
