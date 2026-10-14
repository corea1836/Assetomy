import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { saveSummaryFeedback } from "./summary-feedback";
import { StoreError } from "./store-error";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => ({ rpc })) }));
beforeEach(() => { vi.clearAllMocks(); rpc.mockReset(); });

describe("saveSummaryFeedback", () => {
  it.each(["saved", "deleted"] as const)("sends the RPC arguments and validates %s", async (kind) => {
    rpc.mockResolvedValue({ data: { kind, private: "private-value" }, error: null });
    expect(await saveSummaryFeedback("user-a", "cafe", "평일 오전 커피")).toEqual({ kind });
    expect(createSupabaseAdminClient).toHaveBeenCalledExactlyOnceWith();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_summary_feedback", {
      p_user_id: "user-a", p_category: "cafe", p_body: "평일 오전 커피",
    });
  });

  it.each([null, {}, [], { kind: "invalid" }])(
    "rejects malformed RPC results: %#", async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      const error = await saveSummaryFeedback("user-a", "food", "집밥").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(StoreError);
      expect(error).toMatchObject({ operation: "save_summary_feedback", code: "unexpected_response" });
    },
  );

  it("keeps only RPC error codes and sanitizes rejected promises", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message: "private feedback", details: "private feedback" } });
    const error = await saveSummaryFeedback("user-a", "food", "private feedback").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StoreError);
    expect(error).toMatchObject({ operation: "save_summary_feedback", code: "23514" });
    expect(String(error)).not.toContain("private feedback");

    rpc.mockRejectedValueOnce(new Error("private feedback"));
    await expect(saveSummaryFeedback("user-a", "food", "private feedback"))
      .rejects.toThrow(/^store:save_summary_feedback:unexpected_response$/);
  });
});
