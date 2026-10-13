import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStoredSummary } from "@/lib/queries/summaries";
import { saveSummary } from "@/lib/store/summaries";
import { getMonthlySummarizer } from "@/services/llm";
import type { SummaryDeps } from "./monthly-summary";

export function defaultSummaryDeps(supabase: SupabaseClient): SummaryDeps {
  return {
    loadStored: (userId, month) => getStoredSummary(supabase, userId, month),
    summarizer: getMonthlySummarizer(),
    save: saveSummary,
  };
}
