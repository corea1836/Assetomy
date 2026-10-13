import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePolarGateway } from "@/services/polar/fake-gateway";
import type { SaveSubscriptionInput, SaveSubscriptionResult, StoredSubscription } from "@/types/billing";
import type { BillingDeps } from "./deps";
import { getPlanState, toPlanState } from "./plan";

const free: StoredSubscription = { plan: "free", currentPeriodEnd: null, cancelAtPeriodEnd: false };
const expired: StoredSubscription = { plan: "pro", currentPeriodEnd: "2026-10-13T06:00:00Z", cancelAtPeriodEnd: true };
const active: StoredSubscription = { plan: "pro", currentPeriodEnd: "2026-11-12T15:30:00Z", cancelAtPeriodEnd: false };

function setup() {
  const gateway = createFakePolarGateway();
  const save = vi.fn(async (input: SaveSubscriptionInput): Promise<SaveSubscriptionResult> => ({
    kind: "saved", subscription: { plan: input.plan, currentPeriodEnd: input.currentPeriodEnd, cancelAtPeriodEnd: input.cancelAtPeriodEnd },
  }));
  const deps: BillingDeps = {
    mode: "live", origin: "https://assetomy.test", now: () => new Date("2026-10-13T06:00:00Z"),
    gateway: vi.fn(() => gateway), saveSubscription: save,
    isProductionBilling: () => false, recordMetric: vi.fn(),
  };
  return { deps, gateway, save };
}

afterEach(() => vi.restoreAllMocks());

describe("toPlanState", () => {
  it.each([null, free])("returns Free for %j", (stored) => {
    expect(toPlanState(stored)).toEqual({ plan: "free" });
  });

  it.each([false, true])("converts a Pro timestamp to a Seoul date and preserves cancellation %s", (cancelAtPeriodEnd) => {
    expect(toPlanState({ ...active, cancelAtPeriodEnd })).toEqual({ plan: "pro", periodEnd: "2026-11-13", cancelAtPeriodEnd });
  });

  it("preserves a null mock period", () => {
    expect(toPlanState({ ...active, currentPeriodEnd: null })).toEqual({ plan: "pro", periodEnd: null, cancelAtPeriodEnd: false });
  });
});

describe("getPlanState", () => {
  it.each(["2026-10-13T05:59:59Z", "2026-10-13T06:00:00Z", "2026-10-13T15:00:00+09:00"])(
    "syncs at or after period end %s and reflects Free", async (currentPeriodEnd) => {
      const { deps, gateway } = setup();
      expect(await getPlanState("user-a", { ...expired, currentPeriodEnd }, deps)).toEqual({ plan: "free" });
      expect(gateway.calls).toEqual([{ method: "getCustomerState", input: "user-a" }]);
    },
  );

  it("reflects renewed Pro state after syncing an expired period", async () => {
    const { deps, gateway } = setup();
    gateway.setState("user-a", { kind: "customer", pro: { subscriptionId: "sub-a",
      currentPeriodEnd: active.currentPeriodEnd!, cancelAtPeriodEnd: false } });
    expect(await getPlanState("user-a", expired, deps)).toEqual({ plan: "pro", periodEnd: "2026-11-13", cancelAtPeriodEnd: false });
  });

  it.each([null, free, active, { ...active, currentPeriodEnd: null }])("avoids Polar when no sync is needed: %j", async (stored) => {
    const { deps, gateway, save } = setup();
    expect(await getPlanState("user-a", stored, deps)).toEqual(toPlanState(stored));
    expect(deps.gateway).not.toHaveBeenCalled();
    expect(gateway.calls).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });

  it("syncs an expired period even when sync is explicitly false", async () => {
    const { deps, gateway } = setup();
    expect(await getPlanState("user-a", expired, deps, { sync: false })).toEqual({ plan: "free" });
    expect(gateway.calls).toHaveLength(1);
  });

  it.each([null, free, active, { ...active, currentPeriodEnd: null }])("forces sync regardless of period: %j", async (stored) => {
    const { deps, gateway } = setup();
    expect(await getPlanState("user-a", stored, deps, { sync: true })).toEqual({ plan: "free" });
    expect(gateway.calls).toEqual([{ method: "getCustomerState", input: "user-a" }]);
  });

  it("keeps expired Pro on gateway failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, gateway, save } = setup();
    gateway.failNext("getCustomerState");
    expect(await getPlanState("user-a", expired, deps)).toEqual(toPlanState(expired));
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps stored Pro on save failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, save } = setup();
    save.mockRejectedValueOnce(new Error("private-value"));
    expect(await getPlanState("user-a", expired, deps)).toEqual(toPlanState(expired));
  });

  it("keeps stored state when the user is no longer present", async () => {
    const { deps, save } = setup();
    save.mockResolvedValueOnce({ kind: "user_not_found" });
    expect(await getPlanState("user-a", expired, deps)).toEqual(toPlanState(expired));
  });

  it("uses the newer DB state returned by a stale sync", async () => {
    const { deps, save } = setup();
    save.mockResolvedValueOnce({ kind: "stale", subscription: active });
    expect(await getPlanState("user-a", expired, deps)).toEqual(toPlanState(active));
  });

  it.each([undefined, true])("keeps stored Pro in mock with sync option %s", async (sync) => {
    const { deps, gateway, save } = setup();
    deps.mode = "mock";
    expect(await getPlanState("user-a", expired, deps, { sync })).toEqual(toPlanState(expired));
    expect(deps.gateway).not.toHaveBeenCalled();
    expect(gateway.calls).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });
});
