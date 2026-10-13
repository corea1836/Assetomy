import "server-only";
import { seoulToday } from "@/lib/clock";
import type { PlanState, StoredSubscription } from "@/types/billing";
import type { BillingDeps } from "./deps";
import { syncFromPolar } from "./sync";

export function toPlanState(subscription: StoredSubscription | null): PlanState {
  if (!subscription || subscription.plan === "free") return { plan: "free" };
  return {
    plan: "pro",
    periodEnd: subscription.currentPeriodEnd === null ? null : seoulToday(new Date(subscription.currentPeriodEnd)),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  };
}

export async function getPlanState(
  userId: string, stored: StoredSubscription | null, deps: BillingDeps, options?: { sync?: boolean },
): Promise<PlanState> {
  if (options?.sync === true || (stored?.plan === "pro" && stored.currentPeriodEnd !== null
    && Date.parse(stored.currentPeriodEnd) <= deps.now().getTime())) {
    const result = await syncFromPolar(userId, deps);
    if (result.kind === "synced") return toPlanState(result.subscription);
  }
  return toPlanState(stored);
}
