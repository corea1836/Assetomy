import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { setMerchantCategory } from "./merchant-categories";
import { StoreError } from "./store-error";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => ({ rpc })) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); rpc.mockReset(); });

describe("setMerchantCategory", () => {
  it.each([0, 2])("validates updated %i and sends only the RPC arguments", async (updated) => {
    rpc.mockResolvedValue({ data: { kind: "updated", updated, private: "private-value" }, error: null });
    expect(await setMerchantCategory("user-a", "예시가맹점", "cafe")).toEqual({ kind: "updated", updated });
    expect(createSupabaseAdminClient).toHaveBeenCalledExactlyOnceWith();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("set_merchant_category", {
      p_user_id: "user-a", p_merchant_key: "예시가맹점", p_category: "cafe",
    });
  });

  it("returns not_found and strips unknown fields", async () => {
    rpc.mockResolvedValue({ data: { kind: "not_found", private: "private-value" }, error: null });
    expect(await setMerchantCategory("user-a", "없는가맹점", "etc")).toEqual({ kind: "not_found" });
  });

  it.each([
    null, {}, [], { kind: "invalid" }, { kind: "updated" },
    ...[-1, 1.5, 2 ** 53, "2", null].map((updated) => ({ kind: "updated", updated })),
  ])("rejects malformed RPC responses: %#", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    const error = await setMerchantCategory("user-a", "예시가맹점", "cafe").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StoreError);
    expect(error).toMatchObject({ operation: "set_merchant_category", code: "unexpected_response" });
    expect(JSON.stringify(error)).not.toContain("예시가맹점");
  });

  it("exposes only the RPC error code", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "private-value", details: "private-value", hint: "private-value" } });
    const error = await setMerchantCategory("user-a", "예시가맹점", "cafe").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StoreError);
    expect(String(error)).toBe("Error: store:set_merchant_category:23514");
    expect(JSON.stringify(error)).not.toContain("private-value");
  });

  it("sanitizes rejected RPC promises", async () => {
    rpc.mockRejectedValue(new Error("private-value"));
    await expect(setMerchantCategory("user-a", "예시가맹점", "cafe"))
      .rejects.toThrow(/^store:set_merchant_category:unexpected_response$/);
  });
});
