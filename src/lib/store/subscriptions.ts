import "server-only";
import { z } from "zod";
import type { SaveSubscriptionInput, SaveSubscriptionResult } from "@/types/billing";
import { callStoreRpc } from "./store-error";

const saveSubscriptionResultSchema = z.union([
  z.object({
    kind: z.enum(["saved", "stale"]),
    plan: z.enum(["free", "pro"]),
    current_period_end: z.iso.datetime({ offset: true }).nullable(),
    cancel_at_period_end: z.boolean(),
  }).refine((row) => row.plan !== "free" || (row.current_period_end === null && !row.cancel_at_period_end))
    .transform((row) => ({
      kind: row.kind,
      subscription: { plan: row.plan, currentPeriodEnd: row.current_period_end, cancelAtPeriodEnd: row.cancel_at_period_end },
    })),
  z.object({ kind: z.literal("user_not_found") }),
]);

export async function saveSubscription(input: SaveSubscriptionInput): Promise<SaveSubscriptionResult> {
  const free = input.plan === "free";
  return callStoreRpc("save_subscription", {
    p_user_id: input.userId,
    p_synced_from: input.syncedFrom,
    p_plan: input.plan,
    p_subscription_id: free ? null : input.subscriptionId,
    p_current_period_end: free ? null : input.currentPeriodEnd,
    p_cancel_at_period_end: free ? false : input.cancelAtPeriodEnd,
  }, saveSubscriptionResultSchema);
}
