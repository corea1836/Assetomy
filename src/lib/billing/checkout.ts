import "server-only";
import type { StoredSubscription, UpgradeSource } from "@/types/billing";
import type { BillingDeps } from "./deps";
import { openPortal } from "./portal";
import { syncFromPolar } from "./sync";

export async function startCheckout(
  input: { userId: string; source: UpgradeSource; customerIp: string | null; stored: StoredSubscription | null },
  deps: BillingDeps,
): Promise<string> {
  const { userId, source, customerIp, stored } = input;
  const successUrl = `${deps.origin}/dashboard?checkout=success`;
  const returnUrl = `${deps.origin}/${source === "settings" ? "settings" : "dashboard"}`;

  if (deps.mode === "mock") {
    if (stored?.plan === "pro") return `${deps.origin}/settings`;
    const result = await deps.saveSubscription({
      userId, syncedFrom: deps.now().toISOString(), plan: "pro", subscriptionId: null,
      currentPeriodEnd: null, cancelAtPeriodEnd: false,
    });
    if (result.kind === "user_not_found") throw new Error("billing:checkout:user_not_found");
    return successUrl;
  }

  // 저장된 값은 웹훅 반영 전일 수 있다. 이미 결제한 사용자에게 두 번째 checkout을 만들지 않도록
  // Polar 현재 상태로 판단하고, 동기화가 실패하면 저장된 값으로 판단한다.
  const synced = await syncFromPolar(userId, deps);
  const current = synced.kind === "synced" ? synced.subscription : stored;
  if (current?.plan === "pro") {
    const portalUrl = await openPortal(userId, deps);
    if (portalUrl !== null) return portalUrl;
  }

  return deps.gateway().createCheckoutUrl({ userId, customerIp, successUrl, returnUrl, source });
}
