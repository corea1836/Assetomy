import "server-only";
import { z } from "zod";
import type { SaveSummaryInput, SaveSummaryResult } from "@/types/summary";
import { callStoreRpc } from "./store-error";

const saveSummaryResultSchema = z.object({
  kind: z.enum(["saved", "no_transactions"]),
});

export async function saveSummary(input: SaveSummaryInput): Promise<SaveSummaryResult> {
  return callStoreRpc("save_ai_summary", {
    p_user_id: input.userId,
    p_month: input.month,
    p_plan: input.plan,
    p_model: input.model,
    p_input_hash: input.inputHash,
    p_summary: input.summary,
    p_tips: input.tips,
  }, saveSummaryResultSchema);
}
