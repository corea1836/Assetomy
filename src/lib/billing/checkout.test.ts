import { describe, expect, it, vi } from "vitest";
import { createFakePolarGateway } from "@/services/polar/fake-gateway";
import { StoreError } from "@/lib/store/store-error";
import { UPGRADE_SOURCES, type SaveSubscriptionInput, type SaveSubscriptionResult, type StoredSubscription } from "@/types/billing";
import type { BillingDeps } from "./deps";
import { startCheckout } from "./checkout";

const origin = "https://assetomy.test";
const now = "2026-10-13T06:00:00.000Z";
const pro: StoredSubscription = { plan: "pro", currentPeriodEnd: null, cancelAtPeriodEnd: false };
const input = { userId: "user-a", source: "teaser" as const, customerIp: "203.0.113.10", stored: null };

function setup(mode: BillingDeps["mode"] = "live") {
  const gateway = createFakePolarGateway();
  let row: { syncedFrom: string; subscription: StoredSubscription } | undefined;
  const save = vi.fn(async (input: SaveSubscriptionInput): Promise<SaveSubscriptionResult> => {
    if (row && Date.parse(row.syncedFrom) >= Date.parse(input.syncedFrom)) return { kind: "stale", subscription: row.subscription };
    row = { syncedFrom: input.syncedFrom, subscription: {
      plan: input.plan, currentPeriodEnd: input.currentPeriodEnd, cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    } };
    return { kind: "saved", subscription: row.subscription };
  });
  const deps: BillingDeps = { mode, origin, now: () => new Date(now), gateway: vi.fn(() => gateway), saveSubscription: save };
  return { deps, gateway, save, stored: () => row };
}

describe("startCheckout", () => {
  it.each([null, { plan: "free", currentPeriodEnd: null, cancelAtPeriodEnd: false }] as const)("activates mock Free and returns success: %j", async (stored) => {
    const { deps, gateway, save, stored: row } = setup("mock");
    expect(await startCheckout({ ...input, stored }, deps)).toBe(`${origin}/dashboard?checkout=success`);
    expect(save).toHaveBeenCalledExactlyOnceWith({ userId: "user-a", syncedFrom: now, plan: "pro",
      subscriptionId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
    expect(row()?.subscription).toEqual(pro);
    expect(deps.gateway).not.toHaveBeenCalled();
    expect(gateway.calls).toEqual([]);
  });

  it("returns settings for mock Pro without storing or calling Polar", async () => {
    const { deps, gateway, save } = setup("mock");
    expect(await startCheckout({ ...input, stored: pro }, deps)).toBe(`${origin}/settings`);
    expect(save).not.toHaveBeenCalled();
    expect(deps.gateway).not.toHaveBeenCalled();
    expect(gateway.calls).toEqual([]);
  });

  it.each(UPGRADE_SOURCES)("passes checkout URLs, source, and customer IP for %s", async (source) => {
    const { deps, gateway, save } = setup();
    expect(await startCheckout({ ...input, source }, deps)).toBe("https://polar.test/checkout/user-a");
    expect(gateway.calls).toEqual([{ method: "createCheckoutUrl", input: {
      userId: "user-a", customerIp: input.customerIp, source,
      successUrl: `${origin}/dashboard?checkout=success`, returnUrl: `${origin}/${source === "settings" ? "settings" : "dashboard"}`,
    } }]);
    expect(save).not.toHaveBeenCalled();
  });

  it("passes a null IP and a stored Free plan", async () => {
    const { deps, gateway } = setup();
    await startCheckout({ ...input, customerIp: null, stored: { plan: "free", currentPeriodEnd: null, cancelAtPeriodEnd: false } }, deps);
    expect(gateway.calls[0]).toMatchObject({ method: "createCheckoutUrl", input: { customerIp: null } });
  });

  it("opens the portal for live Pro", async () => {
    const { deps, gateway, save } = setup();
    gateway.setState("user-a", { kind: "customer", pro: null });
    expect(await startCheckout({ ...input, stored: pro }, deps)).toBe("https://polar.test/portal/user-a");
    expect(gateway.calls).toEqual([{ method: "createPortalUrl", input: { userId: "user-a", returnUrl: `${origin}/settings` } }]);
    expect(save).not.toHaveBeenCalled();
  });

  it("falls back to checkout when the stored Pro customer is absent", async () => {
    const { deps, gateway, save } = setup();
    expect(await startCheckout({ ...input, stored: pro }, deps)).toBe("https://polar.test/checkout/user-a");
    expect(gateway.calls).toEqual([
      { method: "createPortalUrl", input: { userId: "user-a", returnUrl: `${origin}/settings` } },
      { method: "createCheckoutUrl", input: { userId: "user-a", customerIp: input.customerIp, source: input.source,
        successUrl: `${origin}/dashboard?checkout=success`, returnUrl: `${origin}/dashboard` } },
    ]);
    expect(save).not.toHaveBeenCalled();
  });

  it.each(["createCheckoutUrl", "createPortalUrl"] as const)("propagates %s failure", async (method) => {
    const { deps, gateway, save } = setup();
    gateway.failNext(method);
    await expect(startCheckout({ ...input, stored: method === "createPortalUrl" ? pro : null }, deps))
      .rejects.toMatchObject({ operation: method === "createPortalUrl" ? "portal" : "checkout", code: "network" });
    expect(gateway.calls).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("propagates mock store errors", async () => {
    const { deps, save } = setup("mock");
    const error = new StoreError("save_subscription", "23514");
    save.mockRejectedValueOnce(error);
    await expect(startCheckout(input, deps)).rejects.toBe(error);
  });

  it("throws instead of returning success for a deleted mock user", async () => {
    const { deps, save } = setup("mock");
    save.mockResolvedValueOnce({ kind: "user_not_found" });
    await expect(startCheckout(input, deps)).rejects.toThrow(/^billing:checkout:user_not_found$/);
  });
});
