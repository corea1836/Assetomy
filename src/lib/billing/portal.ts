import "server-only";
import type { BillingDeps } from "./deps";

export async function openPortal(userId: string, deps: BillingDeps): Promise<string | null> {
  const returnUrl = `${deps.origin}/settings`;
  if (deps.mode === "mock") {
    const result = await deps.saveSubscription({
      userId, syncedFrom: deps.now().toISOString(), plan: "free", subscriptionId: null,
      currentPeriodEnd: null, cancelAtPeriodEnd: false,
    });
    if (result.kind === "user_not_found") throw new Error("billing:portal:user_not_found");
    return returnUrl;
  }
  return deps.gateway().createPortalUrl({ userId, returnUrl });
}
