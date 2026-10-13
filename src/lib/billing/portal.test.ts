import { describe, expect, it, vi } from "vitest";
import { StoreError } from "@/lib/store/store-error";
import { createFakePolarGateway } from "@/services/polar/fake-gateway";
import type { SaveSubscriptionInput, SaveSubscriptionResult, StoredSubscription } from "@/types/billing";
import type { BillingDeps } from "./deps";
import { openPortal } from "./portal";

const origin = "https://assetomy.test";
const now = "2026-10-13T06:00:00.000Z";

function setup(mode: BillingDeps["mode"] = "live") {
  const gateway = createFakePolarGateway();
  let row = { syncedFrom: "2026-10-13T05:00:00Z", subscription: {
    plan: "pro", currentPeriodEnd: "2026-11-12T15:30:00Z", cancelAtPeriodEnd: true,
  } as StoredSubscription };
  const save = vi.fn(async (input: SaveSubscriptionInput): Promise<SaveSubscriptionResult> => {
    if (Date.parse(row.syncedFrom) >= Date.parse(input.syncedFrom)) return { kind: "stale", subscription: row.subscription };
    row = { syncedFrom: input.syncedFrom, subscription: {
      plan: input.plan, currentPeriodEnd: input.currentPeriodEnd, cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    } };
    return { kind: "saved", subscription: row.subscription };
  });
  const deps: BillingDeps = { mode, origin, now: () => new Date(now), gateway: vi.fn(() => gateway), saveSubscription: save,
    isProductionBilling: () => false, recordMetric: vi.fn() };
  return { deps, gateway, save, stored: () => row };
}

describe("openPortal", () => {
  it("stores Free in mock, returns settings, and never calls Polar", async () => {
    const { deps, gateway, save, stored } = setup("mock");
    expect(await openPortal("user-a", deps)).toBe(`${origin}/settings`);
    expect(save).toHaveBeenCalledExactlyOnceWith({ userId: "user-a", syncedFrom: now, plan: "free",
      subscriptionId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
    expect(stored().subscription).toEqual({ plan: "free", currentPeriodEnd: null, cancelAtPeriodEnd: false });
    expect(deps.gateway).not.toHaveBeenCalled();
    expect(gateway.calls).toEqual([]);
  });

  it.each([false, true])("returns a live portal URL or null (customer present: %s)", async (customer) => {
    const { deps, gateway, save } = setup();
    if (customer) gateway.setState("user-a", { kind: "customer", pro: null });
    expect(await openPortal("user-a", deps)).toBe(customer ? "https://polar.test/portal/user-a" : null);
    expect(gateway.calls).toEqual([{ method: "createPortalUrl", input: { userId: "user-a", returnUrl: `${origin}/settings` } }]);
    expect(save).not.toHaveBeenCalled();
  });

  it("propagates live portal errors", async () => {
    const { deps, gateway } = setup();
    gateway.failNext("createPortalUrl");
    await expect(openPortal("user-a", deps)).rejects.toMatchObject({ operation: "portal", code: "network" });
  });

  it("propagates mock store errors", async () => {
    const { deps, save } = setup("mock");
    const error = new StoreError("save_subscription", "23514");
    save.mockRejectedValueOnce(error);
    await expect(openPortal("user-a", deps)).rejects.toBe(error);
  });

  it("throws for a deleted mock user", async () => {
    const { deps, save } = setup("mock");
    save.mockResolvedValueOnce({ kind: "user_not_found" });
    await expect(openPortal("user-a", deps)).rejects.toThrow(/^billing:portal:user_not_found$/);
  });
});
