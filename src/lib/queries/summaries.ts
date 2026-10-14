import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { CATEGORY_IDS } from "@/types/category";
import type { StoredSummary } from "@/types/summary";
import type { YearMonth } from "@/types/transaction";
import { readQuery } from "./query-error";

const storedSummaryResponseSchema = z.object({
  data: z.object({
    input_hash: z.string().regex(/^[0-9a-f]{64}$/),
    summary: z.string().min(1),
    tips: z.array(z.string().min(1)).min(1).max(5),
    tip_categories: z.array(z.enum(CATEGORY_IDS)).min(1).max(5),
  }).refine((row) => row.tips.length === row.tip_categories.length)
    .transform((row) => ({
      inputHash: row.input_hash,
      summary: row.summary,
      tips: row.tips,
      tipCategories: row.tip_categories,
    })).nullable(),
});

export async function getStoredSummary(
  supabase: SupabaseClient,
  userId: string,
  month: YearMonth,
): Promise<StoredSummary | null> {
  const { data } = await readQuery("getStoredSummary", () => supabase.from("ai_summaries")
    .select("input_hash, summary, tips, tip_categories")
    .eq("user_id", userId).eq("month", month).maybeSingle(), storedSummaryResponseSchema);
  return data;
}

export async function getStoredCardSummary(
  supabase: SupabaseClient, userId: string, cardId: string, period: string,
): Promise<StoredSummary | null> {
  const { data } = await readQuery("getStoredCardSummary", () => supabase.from("card_summaries")
    .select("input_hash, summary, tips, tip_categories")
    .eq("user_id", userId).eq("card_id", cardId).eq("period", period).maybeSingle(), storedSummaryResponseSchema);
  return data;
}
