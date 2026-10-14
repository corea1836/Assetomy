import "server-only";
import { z } from "zod";
import type { NewCardInput } from "@/types/card";
import type { CreateCardResult } from "@/types/upload";
import { callStoreRpc } from "./store-error";

const createCardResultSchema = z.union([
  z.object({ kind: z.literal("created"), card_id: z.uuid() })
    .transform((result) => ({ kind: result.kind, cardId: result.card_id })),
  z.object({ kind: z.literal("duplicate_label") }),
  z.object({ kind: z.literal("invalid_label") }),
]);

export async function createCard(userId: string, input: NewCardInput): Promise<CreateCardResult> {
  return callStoreRpc("create_card", {
    p_user_id: userId,
    p_label: input.label,
    p_issuer: input.issuer,
    p_analysis_basis: input.analysisBasis,
    p_cycle_start_day: input.cycleStartDay,
  }, createCardResultSchema);
}
