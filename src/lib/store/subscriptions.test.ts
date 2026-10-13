import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SaveSubscriptionInput } from "@/types/billing";
import { saveSubscription } from "./subscriptions";
import { StoreError } from "./store-error";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => ({ rpc })) }));
beforeEach(() => { vi.clearAllMocks(); rpc.mockReset(); });

const input: SaveSubscriptionInput = {
  userId: "user-a", syncedFrom: "2026-10-13T06:00:00.000Z", plan: "pro", subscriptionId: "sub-a",
  currentPeriodEnd: "2026-11-12T15:30:00+00:00", cancelAtPeriodEnd: true,
};
const pro = { plan: "pro", current_period_end: input.currentPeriodEnd, cancel_at_period_end: true };

describe("saveSubscription", () => {
  it.each(["saved", "stale"])("maps %s to the stored subscription and uses exact RPC arguments", async (kind) => {
    rpc.mockResolvedValue({ data: { kind, ...pro }, error: null });
    expect(await saveSubscription(input)).toEqual({ kind, subscription: {
      plan: "pro", currentPeriodEnd: input.currentPeriodEnd, cancelAtPeriodEnd: true,
    } });
    expect(createSupabaseAdminClient).toHaveBeenCalledExactlyOnceWith();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_subscription", {
      p_user_id: input.userId, p_synced_from: input.syncedFrom, p_plan: "pro", p_subscription_id: "sub-a",
      p_current_period_end: input.currentPeriodEnd, p_cancel_at_period_end: true,
    });
  });

  it("clears all Pro fields when saving Free", async () => {
    rpc.mockResolvedValue({ data: { kind: "saved", plan: "free", current_period_end: null, cancel_at_period_end: false }, error: null });
    expect(await saveSubscription({ ...input, plan: "free" })).toEqual({ kind: "saved", subscription: {
      plan: "free", currentPeriodEnd: null, cancelAtPeriodEnd: false,
    } });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_subscription", {
      p_user_id: input.userId, p_synced_from: input.syncedFrom, p_plan: "free", p_subscription_id: null,
      p_current_period_end: null, p_cancel_at_period_end: false,
    });
  });

  it("allows mock Pro with a null period and subscription id", async () => {
    rpc.mockResolvedValue({ data: { kind: "saved", plan: "pro", current_period_end: null, cancel_at_period_end: false }, error: null });
    expect(await saveSubscription({ ...input, subscriptionId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false }))
      .toEqual({ kind: "saved", subscription: { plan: "pro", currentPeriodEnd: null, cancelAtPeriodEnd: false } });
    expect(rpc.mock.calls[0][1].p_subscription_id).toBeNull();
  });

  it("returns user_not_found and strips unknown fields", async () => {
    rpc.mockResolvedValue({ data: { kind: "user_not_found", private: "private-value" }, error: null });
    expect(await saveSubscription(input)).toEqual({ kind: "user_not_found" });
    rpc.mockResolvedValue({ data: { kind: "saved", ...pro, private: "private-value" }, error: null });
    expect(await saveSubscription(input)).toEqual({ kind: "saved", subscription: {
      plan: "pro", currentPeriodEnd: input.currentPeriodEnd, cancelAtPeriodEnd: true,
    } });
  });

  it.each([
    null, {}, { kind: "unknown" }, { kind: "saved" }, { kind: "stale", ...pro, plan: "other" },
    { kind: "saved", ...pro, current_period_end: "2026-11-12" },
    { kind: "saved", ...pro, current_period_end: "invalid" },
    { kind: "saved", ...pro, cancel_at_period_end: "true" },
    { kind: "saved", ...pro, plan: "free" },
    { kind: "saved", plan: "free", current_period_end: null, cancel_at_period_end: true },
  ])("rejects malformed responses as StoreError: %#", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    const error = await saveSubscription(input).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StoreError);
    expect(error).toMatchObject({ operation: "save_subscription", code: "unexpected_response" });
  });

  it.each(["23514", "PGRST202"])("exposes only the RPC error code %s", async (code) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "private-value", details: "private-value", hint: "private-value" } });
    const error = await saveSubscription(input).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StoreError);
    expect(error).toMatchObject({ operation: "save_subscription", code });
    expect(String(error)).not.toContain("private-value");
    expect(JSON.stringify(error)).not.toContain("private-value");
  });

  it("sanitizes rejected RPC promises", async () => {
    rpc.mockRejectedValue(new Error("private-value"));
    await expect(saveSubscription(input)).rejects.toThrow(/^store:save_subscription:unexpected_response$/);
  });
});
