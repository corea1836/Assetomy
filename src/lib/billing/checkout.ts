import "server-only";
import type { StoredSubscription, UpgradeSource } from "@/types/billing";
import type { BillingDeps } from "./deps";
import { openPortal } from "./portal";

export async function startCheckout(
  input: { userId: string; source: UpgradeSource; customerIp: string | null; stored: StoredSubscription | null },
  deps: BillingDeps,
): Promise<string> {
  const { userId, source, customerIp, stored } = input;
  const successUrl = `${deps.origin}/dashboard?checkout=success`;
  const returnUrl = `${deps.origin}/${source === "settings" ? "settings" : "dashboard"}`;

  if (stored?.plan === "pro") {
    if (deps.mode === "mock") return `${deps.origin}/settings`;
    const portalUrl = await openPortal(userId, deps);
    if (portalUrl !== null) return portalUrl;
  }

  if (deps.mode === "mock") {
    const result = await deps.saveSubscription({
      userId, syncedFrom: deps.now().toISOString(), plan: "pro", subscriptionId: null,
      currentPeriodEnd: null, cancelAtPeriodEnd: false,
    });
    if (result.kind === "user_not_found") throw new Error("billing:checkout:user_not_found");
    return successUrl;
  }

  return deps.gateway().createCheckoutUrl({ userId, customerIp, successUrl, returnUrl, source });
}
