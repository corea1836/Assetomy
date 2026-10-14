import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStoredCardSummary, getStoredSummary } from "@/lib/queries/summaries";
import { saveCardSummary, saveSummary } from "@/lib/store/summaries";
import { getCardSummarizer, getMonthlySummarizer } from "@/services/llm";
import type { CardSummaryDeps } from "./card-summary";
import type { SummaryDeps } from "./monthly-summary";

export function defaultSummaryDeps(supabase: SupabaseClient): SummaryDeps {
  return {
    loadStored: (userId, month) => getStoredSummary(supabase, userId, month),
    summarizer: getMonthlySummarizer(),
    save: saveSummary,
  };
}

export function defaultCardSummaryDeps(supabase: SupabaseClient): CardSummaryDeps {
  return {
    loadStored: (userId, cardId, period) => getStoredCardSummary(supabase, userId, cardId, period),
    summarizer: getCardSummarizer(),
    save: saveCardSummary,
  };
}
