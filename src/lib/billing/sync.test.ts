import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreError } from "@/lib/store/store-error";
import { createFakePolarGateway } from "@/services/polar/fake-gateway";
import { PolarGatewayError, type PolarCustomerState } from "@/services/polar/types";
import type { SaveSubscriptionInput, SaveSubscriptionResult, StoredSubscription } from "@/types/billing";
import type { BillingDeps } from "./deps";
import { syncFromPolar } from "./sync";

const startedAt = "2026-10-13T06:00:00.000Z";
const pro = { subscriptionId: "sub-a", currentPeriodEnd: "2026-11-12T15:30:00Z", cancelAtPeriodEnd: true };
const free: StoredSubscription = { plan: "free", currentPeriodEnd: null, cancelAtPeriodEnd: false };

function setup(state: PolarCustomerState = { kind: "no_customer" }) {
  const gateway = createFakePolarGateway({ "user-a": state });
  const rows = new Map<string, { syncedFrom: string; subscription: StoredSubscription }>();
  const save = vi.fn(async (input: SaveSubscriptionInput): Promise<SaveSubscriptionResult> => {
    const stored = rows.get(input.userId);
    if (stored && Date.parse(stored.syncedFrom) >= Date.parse(input.syncedFrom)) {
      return { kind: "stale", subscription: stored.subscription };
    }
    const subscription: StoredSubscription = {
      plan: input.plan, currentPeriodEnd: input.currentPeriodEnd, cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    };
    rows.set(input.userId, { syncedFrom: input.syncedFrom, subscription });
    return { kind: "saved", subscription };
  });
  const deps: BillingDeps = {
    mode: "live", origin: "https://assetomy.test", now: vi.fn(() => new Date(startedAt)),
    gateway: vi.fn(() => gateway), saveSubscription: save,
    isProductionBilling: vi.fn(() => false), recordMetric: vi.fn(async () => ({ kind: "recorded" as const })),
  };
  return { deps, gateway, save, rows };
}

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe("syncFromPolar", () => {
  it("skips mock without calling the gateway, clock, or store", async () => {
    const { deps, gateway, save } = setup({ kind: "customer", pro });
    deps.isProductionBilling = vi.fn(() => true);
    deps.mode = "mock";
    expect(await syncFromPolar("user-a", deps)).toEqual({ kind: "skipped" });
    expect(deps.gateway).not.toHaveBeenCalled();
    expect(deps.now).not.toHaveBeenCalled();
    expect(gateway.calls).toEqual([]);
    expect(save).not.toHaveBeenCalled();
    expect(deps.isProductionBilling).not.toHaveBeenCalled();
    expect(deps.recordMetric).not.toHaveBeenCalled();
  });

  it.each([{ kind: "no_customer" }, { kind: "customer", pro: null }] as const)("confirms Free for %j", async (state) => {
    const { deps, gateway, save } = setup(state);
    expect(await syncFromPolar("user-a", deps)).toEqual({ kind: "synced", subscription: free });
    expect(gateway.calls).toEqual([{ method: "getCustomerState", input: "user-a" }]);
    expect(save).toHaveBeenCalledExactlyOnceWith({
      userId: "user-a", syncedFrom: startedAt, plan: "free", subscriptionId: null,
      currentPeriodEnd: null, cancelAtPeriodEnd: false,
    });
    expect(deps.recordMetric).not.toHaveBeenCalled();
  });

  it("saves all Pro fields from current Polar state", async () => {
    const { deps, save } = setup({ kind: "customer", pro });
    expect(await syncFromPolar("user-a", deps)).toEqual({ kind: "synced", subscription: {
      plan: "pro", currentPeriodEnd: pro.currentPeriodEnd, cancelAtPeriodEnd: true,
    } });
    expect(save).toHaveBeenCalledExactlyOnceWith({ userId: "user-a", syncedFrom: startedAt, plan: "pro", ...pro });
  });

  it("captures the start time before creating and calling the gateway", async () => {
    const { deps, gateway, save } = setup();
    const order: string[] = [];
    let current = startedAt;
    deps.now = vi.fn(() => { order.push("now"); return new Date(current); });
    deps.gateway = () => { order.push("gateway"); return gateway; };
    const original = gateway.getCustomerState;
    vi.spyOn(gateway, "getCustomerState").mockImplementation(async (userId) => {
      order.push("get_state"); current = "2026-10-13T06:05:00.000Z";
      return original(userId);
    });
    await syncFromPolar("user-a", deps);
    expect(order).toEqual(["now", "gateway", "get_state"]);
    expect(save.mock.calls[0][0].syncedFrom).toBe(startedAt);
  });

  it("does not save Free on gateway failure", async () => {
    const { deps, gateway, save, rows } = setup();
    rows.set("user-a", { syncedFrom: "2026-10-13T05:00:00Z", subscription: {
      plan: "pro", currentPeriodEnd: pro.currentPeriodEnd, cancelAtPeriodEnd: true,
    } });
    gateway.failNext("getCustomerState");
    expect(await syncFromPolar("user-a", deps)).toEqual({ kind: "failed" });
    expect(save).not.toHaveBeenCalled();
    expect(rows.get("user-a")?.subscription.plan).toBe("pro");
    expect(console.error).toHaveBeenCalledExactlyOnceWith("billing:sync:get_state:network", "user-a");
    expect(deps.recordMetric).not.toHaveBeenCalled();
  });

  it("handles gateway factory throws without passing the error to logs", async () => {
    const { deps, save } = setup();
    deps.gateway = () => { throw new Error("private-value"); };
    expect(await syncFromPolar("user-a", deps)).toEqual({ kind: "failed" });
    expect(save).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("billing:sync:get_state:unexpected_error", "user-a");
  });

  it.each([
    [new StoreError("save_subscription", "23514"), "23514"],
    [new Error("private-value"), "unexpected_error"],
  ])("handles store failure with only a code and id in logs: %#", async (error, code) => {
    const { deps, save } = setup();
    save.mockRejectedValueOnce(error);
    expect(await syncFromPolar("user-a", deps)).toEqual({ kind: "failed" });
    expect(save).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(`billing:sync:save_subscription:${code}`, "user-a");
    expect(deps.recordMetric).not.toHaveBeenCalled();
  });

  it("does not log error messages or arbitrary fields", async () => {
    const { deps, gateway, save } = setup();
    const error = new PolarGatewayError("get_state", "503");
    error.message = "private-value";
    Object.assign(error, { details: "private-value", hint: "private-value" });
    vi.spyOn(gateway, "getCustomerState").mockRejectedValueOnce(error);
    expect(await syncFromPolar("user-a", deps)).toEqual({ kind: "failed" });
    expect(save).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("billing:sync:get_state:503", "user-a");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-value");
  });

  it.each([startedAt, "2026-10-13T06:01:00.000Z"])("returns the newer DB state for stale or equal start time %s", async (syncedFrom) => {
    const { deps, rows } = setup({ kind: "customer", pro });
    rows.set("user-a", { syncedFrom, subscription: free });
    expect(await syncFromPolar("user-a", deps)).toEqual({ kind: "synced", subscription: free });
    expect(rows.get("user-a")).toEqual({ syncedFrom, subscription: free });
    deps.isProductionBilling = vi.fn(() => true);
    expect(await syncFromPolar("user-a", deps)).toEqual({ kind: "synced", subscription: free });
    expect(deps.recordMetric).not.toHaveBeenCalled();
  });

  it("returns user_not_found for a deleted user", async () => {
    const { deps, save } = setup({ kind: "customer", pro });
    deps.isProductionBilling = vi.fn(() => true);
    save.mockResolvedValueOnce({ kind: "user_not_found" });
    expect(await syncFromPolar("user-a", deps)).toEqual({ kind: "user_not_found" });
    expect(console.error).not.toHaveBeenCalled();
    expect(deps.recordMetric).not.toHaveBeenCalled();
  });

  it("records first_paid after saving Pro in production billing", async () => {
    const { deps, save } = setup({ kind: "customer", pro });
    deps.isProductionBilling = vi.fn(() => true);
    expect(await syncFromPolar("user-a", deps)).toEqual({ kind: "synced", subscription: {
      plan: "pro", currentPeriodEnd: pro.currentPeriodEnd, cancelAtPeriodEnd: true,
    } });
    expect(deps.isProductionBilling).toHaveBeenCalledExactlyOnceWith();
    expect(deps.recordMetric).toHaveBeenCalledExactlyOnceWith("user-a", { event: "first_paid" });
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deps.recordMetric).mock.invocationCallOrder[0]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("does not record sandbox Pro", async () => {
    const { deps } = setup({ kind: "customer", pro });
    expect(await syncFromPolar("user-a", deps)).toMatchObject({ kind: "synced", subscription: { plan: "pro" } });
    expect(deps.isProductionBilling).toHaveBeenCalledExactlyOnceWith();
    expect(deps.recordMetric).not.toHaveBeenCalled();
  });

  it.each(["gateway", "store"] as const)("does not record first_paid when production %s fails", async (operation) => {
    const { deps, gateway, save } = setup({ kind: "customer", pro });
    deps.isProductionBilling = vi.fn(() => true);
    if (operation === "gateway") gateway.failNext("getCustomerState");
    else save.mockRejectedValueOnce(new StoreError("save_subscription", "23514"));
    expect(await syncFromPolar("user-a", deps)).toEqual({ kind: "failed" });
    expect(deps.isProductionBilling).not.toHaveBeenCalled();
    expect(deps.recordMetric).not.toHaveBeenCalled();
  });

  it.each([{ kind: "no_customer" }, { kind: "customer", pro: null }] as const)("does not record production Free for %j", async (state) => {
    const { deps } = setup(state);
    deps.isProductionBilling = vi.fn(() => true);
    expect(await syncFromPolar("user-a", deps)).toEqual({ kind: "synced", subscription: free });
    expect(deps.recordMetric).not.toHaveBeenCalled();
    expect(deps.isProductionBilling).not.toHaveBeenCalled();
  });

  it("uses a stale save's stored Pro plan even when the queried state is Free", async () => {
    const { deps, rows } = setup();
    deps.isProductionBilling = vi.fn(() => true);
    const subscription: StoredSubscription = { plan: "pro", currentPeriodEnd: pro.currentPeriodEnd, cancelAtPeriodEnd: true };
    rows.set("user-a", { syncedFrom: "2026-10-13T06:01:00.000Z", subscription });
    expect(await syncFromPolar("user-a", deps)).toEqual({ kind: "synced", subscription });
    expect(deps.recordMetric).toHaveBeenCalledExactlyOnceWith("user-a", { event: "first_paid" });
  });

  it.each(["recorded", "unchanged", "user_not_found"] as const)("preserves synced Pro when the metric result is %s", async (kind) => {
    const { deps } = setup({ kind: "customer", pro });
    deps.isProductionBilling = vi.fn(() => true);
    deps.recordMetric = vi.fn(async () => ({ kind }));
    expect(await syncFromPolar("user-a", deps)).toMatchObject({ kind: "synced", subscription: { plan: "pro" } });
    expect(deps.recordMetric).toHaveBeenCalledExactlyOnceWith("user-a", { event: "first_paid" });
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([
    [new StoreError("record_metric", "PGRST202"), "PGRST202"],
    [new Error("private-value"), "unexpected_error"],
    [new PolarGatewayError("get_state", "503"), "unexpected_error"],
  ])("preserves synced Pro after a metric failure and logs only code and id: %#", async (error, code) => {
    const { deps } = setup({ kind: "customer", pro });
    deps.isProductionBilling = vi.fn(() => true);
    deps.recordMetric = vi.fn().mockRejectedValue(error);
    expect(await syncFromPolar("user-a", deps)).toEqual({ kind: "synced", subscription: {
      plan: "pro", currentPeriodEnd: pro.currentPeriodEnd, cancelAtPeriodEnd: true,
    } });
    expect(console.error).toHaveBeenCalledExactlyOnceWith(`billing:first_paid:${code}`, "user-a");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-value");
  });
});
