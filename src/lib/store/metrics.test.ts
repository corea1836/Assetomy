import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { UPGRADE_SOURCES } from "@/types/billing";
import { recordMetric } from "./metrics";
import { StoreError } from "./store-error";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => ({ rpc })) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); rpc.mockReset(); });

describe("recordMetric", () => {
  it.each(["teaser_seen", "first_paid"] as const)("passes null source for %s", async (event) => {
    rpc.mockResolvedValue({ data: { kind: "recorded" }, error: null });
    expect(await recordMetric("user-a", { event })).toEqual({ kind: "recorded" });
    expect(createSupabaseAdminClient).toHaveBeenCalledExactlyOnceWith();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_metric", { p_user_id: "user-a", p_event: event, p_source: null });
  });

  it.each(UPGRADE_SOURCES)("passes the upgrade_click source %s", async (source) => {
    rpc.mockResolvedValue({ data: { kind: "recorded" }, error: null });
    expect(await recordMetric("user-a", { event: "upgrade_click", source })).toEqual({ kind: "recorded" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_metric", { p_user_id: "user-a", p_event: "upgrade_click", p_source: source });
  });

  it.each(["recorded", "unchanged", "user_not_found"])("validates %s and strips unknown fields", async (kind) => {
    rpc.mockResolvedValue({ data: { kind, private: "private-value" }, error: null });
    expect(await recordMetric("user-a", { event: "first_paid" })).toEqual({ kind });
  });

  it.each([null, {}, [], { kind: "invalid" }, { kind: 1 }])("rejects malformed RPC responses: %#", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    const error = await recordMetric("user-a", { event: "teaser_seen" }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StoreError);
    expect(error).toMatchObject({ operation: "record_metric", code: "unexpected_response" });
  });

  it("exposes only the RPC error code", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "private-value", details: "private-value", hint: "private-value" } });
    const error = await recordMetric("user-a", { event: "first_paid" }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StoreError);
    expect(String(error)).toBe("Error: store:record_metric:PGRST202");
    expect(JSON.stringify(error)).not.toContain("private-value");
  });

  it("sanitizes rejected RPC promises", async () => {
    rpc.mockRejectedValue(new Error("private-value"));
    await expect(recordMetric("user-a", { event: "first_paid" })).rejects.toThrow(/^store:record_metric:unexpected_response$/);
  });
});
