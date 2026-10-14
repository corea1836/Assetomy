import "server-only";
import { z } from "zod";
import type { SaveCardSummaryInput, SaveCardSummaryResult, SaveSummaryInput, SaveSummaryResult } from "@/types/summary";
import { callStoreRpc } from "./store-error";

const saveSummaryResultSchema = z.object({
  kind: z.enum(["saved", "no_transactions"]),
});

const saveCardSummaryResultSchema = z.object({
  kind: z.enum(["saved", "card_not_found", "basis_mismatch", "no_data"]),
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

export async function saveCardSummary(input: SaveCardSummaryInput): Promise<SaveCardSummaryResult> {
  return callStoreRpc("save_card_summary", {
    p_user_id: input.userId,
    p_card_id: input.cardId,
    p_period: input.period,
    p_plan: input.plan,
    p_model: input.model,
    p_input_hash: input.inputHash,
    p_summary: input.summary,
    p_tips: input.tips,
  }, saveCardSummaryResultSchema);
}
