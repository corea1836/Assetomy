import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { CATEGORY_IDS } from "@/types/category";
import type { SummaryFeedback } from "@/types/summary";
import { readQuery } from "./query-error";

const PAGE_SIZE = 1000;
const summaryFeedbackResponseSchema = z.object({
  data: z.array(z.object({ category: z.enum(CATEGORY_IDS), body: z.string().min(1).max(400) })),
});

export async function listSummaryFeedback(
  supabase: SupabaseClient, userId: string,
): Promise<SummaryFeedback> {
  const feedback: SummaryFeedback = {};
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data } = await readQuery("listSummaryFeedback", () => supabase.from("summary_feedback")
      .select("category, body")
      .eq("user_id", userId)
      .order("category")
      .range(offset, offset + PAGE_SIZE - 1), summaryFeedbackResponseSchema);
    for (const row of data) feedback[row.category] = row.body;
    if (data.length < PAGE_SIZE) return feedback;
  }
}
