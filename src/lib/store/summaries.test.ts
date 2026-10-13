import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SaveSummaryInput } from "@/types/summary";
import { saveSummary } from "./summaries";
import { StoreError } from "./store-error";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => ({ rpc })) }));
beforeEach(() => { vi.clearAllMocks(); rpc.mockReset(); });

const input: SaveSummaryInput = {
  userId: "user-a", month: "2026-09", plan: "free", model: "claude-sonnet-5-5",
  inputHash: "a".repeat(64), summary: "식비 비중이 커졌어요.",
};

describe("saveSummary", () => {
  it.each(["saved", "no_transactions"] as const)("returns %s and sends exact RPC arguments", async (kind) => {
    rpc.mockResolvedValue({ data: { kind }, error: null });
    expect(await saveSummary(input)).toEqual({ kind });
    expect(createSupabaseAdminClient).toHaveBeenCalledExactlyOnceWith();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_ai_summary", {
      p_user_id: input.userId, p_month: input.month, p_plan: input.plan, p_model: input.model,
      p_input_hash: input.inputHash, p_summary: input.summary,
    });
  });

  it("strips unknown response fields", async () => {
    rpc.mockResolvedValue({ data: { kind: "saved", private: "private-value" }, error: null });
    expect(await saveSummary(input)).toEqual({ kind: "saved" });
  });

  it.each([null, {}, { kind: "unknown" }, { kind: "not_saved", private: "value" }])(
    "rejects malformed responses as StoreError: %#", async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      const error = await saveSummary(input).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(StoreError);
      expect(error).toMatchObject({ operation: "save_ai_summary", code: "unexpected_response" });
    },
  );

  it("exposes only the RPC error code", async () => {
    rpc.mockResolvedValue({ data: null, error: {
      code: "PGRST202", message: "private-value", details: "private-value", hint: "private-value",
    } });
    const error = await saveSummary(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StoreError);
    expect(error).toMatchObject({ operation: "save_ai_summary", code: "PGRST202" });
    expect(String(error)).not.toContain("private-value");
    expect(JSON.stringify(error)).not.toContain("private-value");
  });

  it("sanitizes rejected RPC promises", async () => {
    rpc.mockRejectedValue(new Error("private-value"));
    await expect(saveSummary(input)).rejects.toThrow(/^store:save_ai_summary:unexpected_response$/);
  });
});
