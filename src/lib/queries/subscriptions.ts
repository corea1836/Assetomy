import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { StoredSubscription } from "@/types/billing";
import { readQuery } from "./query-error";

const subscriptionResponseSchema = z.object({
  data: z.object({
    plan: z.enum(["free", "pro"]),
    current_period_end: z.iso.datetime({ offset: true }).nullable(),
    cancel_at_period_end: z.boolean(),
  }).refine((row) => row.plan !== "free" || (row.current_period_end === null && !row.cancel_at_period_end))
    .transform((row) => ({
      plan: row.plan, currentPeriodEnd: row.current_period_end, cancelAtPeriodEnd: row.cancel_at_period_end,
    })).nullable(),
});

export async function getSubscription(supabase: SupabaseClient, userId: string): Promise<StoredSubscription | null> {
  const { data } = await readQuery("getSubscription", () => supabase.from("subscriptions")
    .select("plan, current_period_end, cancel_at_period_end")
    .eq("user_id", userId).maybeSingle(), subscriptionResponseSchema);
  return data;
}
