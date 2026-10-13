import "server-only";
import { StoreError } from "@/lib/store/store-error";
import { PolarGatewayError } from "@/services/polar/types";
import type { StoredSubscription } from "@/types/billing";
import type { BillingDeps } from "./deps";

export type SyncResult =
  | { kind: "synced"; subscription: StoredSubscription }
  | { kind: "skipped" }
  | { kind: "failed" }
  | { kind: "user_not_found" };

export async function syncFromPolar(userId: string, deps: BillingDeps): Promise<SyncResult> {
  if (deps.mode === "mock") return { kind: "skipped" };

  let operation = "get_state";
  try {
    const startedAt = deps.now();
    const state = await deps.gateway().getCustomerState(userId);
    const pro = state.kind === "customer" ? state.pro : null;
    operation = "save_subscription";
    const result = await deps.saveSubscription({
      userId, syncedFrom: startedAt.toISOString(), plan: pro ? "pro" : "free",
      subscriptionId: pro?.subscriptionId ?? null,
      currentPeriodEnd: pro?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: pro?.cancelAtPeriodEnd ?? false,
    });
    if (result.kind === "user_not_found") return result;
    return { kind: "synced", subscription: result.subscription };
  } catch (error) {
    const code = error instanceof PolarGatewayError || error instanceof StoreError ? error.code : "unexpected_error";
    console.error(`billing:sync:${operation}:${code}`, userId);
    return { kind: "failed" };
  }
}
