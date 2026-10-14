import "server-only";
import { z } from "zod";
import type { CategoryId } from "@/types/category";
import type { SaveSummaryFeedbackResult } from "@/types/summary";
import { callStoreRpc } from "./store-error";

const saveSummaryFeedbackResultSchema = z.object({ kind: z.enum(["saved", "deleted"]) });

export async function saveSummaryFeedback(
  userId: string, category: CategoryId, body: string,
): Promise<SaveSummaryFeedbackResult> {
  return callStoreRpc("save_summary_feedback", {
    p_user_id: userId, p_category: category, p_body: body,
  }, saveSummaryFeedbackResultSchema);
}
