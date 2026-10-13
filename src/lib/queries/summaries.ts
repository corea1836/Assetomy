import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { StoredSummary } from "@/types/summary";
import type { YearMonth } from "@/types/transaction";
import { readQuery } from "./query-error";

const storedSummaryResponseSchema = z.object({
  data: z.object({
    input_hash: z.string().regex(/^[0-9a-f]{64}$/),
    summary: z.string().min(1),
  }).transform((row) => ({ inputHash: row.input_hash, summary: row.summary })).nullable(),
});

export async function getStoredSummary(
  supabase: SupabaseClient,
  userId: string,
  month: YearMonth,
): Promise<StoredSummary | null> {
  const { data } = await readQuery("getStoredSummary", () => supabase.from("ai_summaries")
    .select("input_hash, summary")
    .eq("user_id", userId).eq("month", month).maybeSingle(), storedSummaryResponseSchema);
  return data;
}
