import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { QueryError } from "./query-error";
import { getSubscription } from "./subscriptions";

function fakeClient(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  const from = vi.fn(() => builder);
  return { client: { from } as unknown as SupabaseClient, from, builder };
}

describe("getSubscription", () => {
  it.each([
    [null, null],
    [{ plan: "free", current_period_end: null, cancel_at_period_end: false }, { plan: "free", currentPeriodEnd: null, cancelAtPeriodEnd: false }],
    [{ plan: "pro", current_period_end: "2026-11-12T15:30:00+00:00", cancel_at_period_end: true },
      { plan: "pro", currentPeriodEnd: "2026-11-12T15:30:00+00:00", cancelAtPeriodEnd: true }],
    [{ plan: "pro", current_period_end: null, cancel_at_period_end: false }, { plan: "pro", currentPeriodEnd: null, cancelAtPeriodEnd: false }],
  ])("maps the subscription and explicitly scopes the supplied client: %#", async (data, expected) => {
    const { client, from, builder } = fakeClient(data);
    expect(await getSubscription(client, "user-a")).toEqual(expected);
    expect(from).toHaveBeenCalledExactlyOnceWith("subscriptions");
    expect(builder.select).toHaveBeenCalledExactlyOnceWith("plan, current_period_end, cancel_at_period_end");
    expect(builder.eq).toHaveBeenCalledExactlyOnceWith("user_id", "user-a");
    expect(builder.maybeSingle).toHaveBeenCalledExactlyOnceWith();
  });

  it("does not expose extra DB fields", async () => {
    const { client } = fakeClient({ plan: "free", current_period_end: null, cancel_at_period_end: false, polar_subscription_id: "private-value" });
    expect(await getSubscription(client, "user-a")).toEqual({ plan: "free", currentPeriodEnd: null, cancelAtPeriodEnd: false });
  });

  it.each([
    undefined, {}, { plan: "other", current_period_end: null, cancel_at_period_end: false },
    { plan: "pro", current_period_end: "2026-11-12", cancel_at_period_end: true },
    { plan: "pro", current_period_end: null, cancel_at_period_end: "false" },
    { plan: "free", current_period_end: "2026-11-12T15:30:00Z", cancel_at_period_end: false },
    { plan: "free", current_period_end: null, cancel_at_period_end: true },
  ])("rejects malformed rows as QueryError: %#", async (data) => {
    const error = await getSubscription(fakeClient(data).client, "user-a").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(QueryError);
    expect(error).toMatchObject({ operation: "getSubscription", code: "unexpected_response" });
  });

  it("keeps only the DB error code", async () => {
    const { client } = fakeClient(null, { code: "PGRST205", message: "private-value", details: "private-value", hint: "private-value" });
    const error = await getSubscription(client, "user-a").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(QueryError);
    expect(error).toMatchObject({ operation: "getSubscription", code: "PGRST205" });
    expect(String(error)).not.toContain("private-value");
    expect(JSON.stringify(error)).not.toContain("private-value");
  });

  it("sanitizes query throws", async () => {
    const { client, builder } = fakeClient(null);
    builder.maybeSingle.mockRejectedValue(new Error("private-value"));
    await expect(getSubscription(client, "user-a")).rejects.toThrow(/^query:getSubscription:unexpected_response$/);
  });
});
