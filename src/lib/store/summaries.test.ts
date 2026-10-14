import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SaveCardSummaryInput, SaveSummaryInput } from "@/types/summary";
import { saveCardSummary, saveSummary } from "./summaries";
import { StoreError } from "./store-error";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => ({ rpc })) }));
beforeEach(() => { vi.clearAllMocks(); rpc.mockReset(); });

const input: SaveSummaryInput = {
  userId: "user-a", month: "2026-09", plan: "free", model: "claude-sonnet-5-5",
  inputHash: "a".repeat(64), summary: "식비 비중이 커졌어요.", tips: ["식비 예산을 정해 보세요."],
};
const cardInput: SaveCardSummaryInput = {
  userId: "user-a", cardId: "11111111-1111-4111-8111-111111111111", period: "2026-10-23",
  plan: "pro", model: "claude-opus-5-5", inputHash: "b".repeat(64), summary: "이번 명세서는 식비가 늘었어요.",
  tips: ["다음 달 식비 예산을 정해 보세요."],
};

describe("saveSummary", () => {
  it.each(["saved", "no_transactions"] as const)("returns %s and sends exact RPC arguments", async (kind) => {
    rpc.mockResolvedValue({ data: { kind }, error: null });
    expect(await saveSummary(input)).toEqual({ kind });
    expect(createSupabaseAdminClient).toHaveBeenCalledExactlyOnceWith();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_ai_summary", {
      p_user_id: input.userId, p_month: input.month, p_plan: input.plan, p_model: input.model,
      p_input_hash: input.inputHash, p_summary: input.summary, p_tips: input.tips,
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

describe("saveCardSummary", () => {
  it.each(["saved", "card_not_found", "basis_mismatch", "no_data"] as const)(
    "returns %s and sends exact RPC arguments", async (kind) => {
      rpc.mockResolvedValue({ data: { kind }, error: null });
      expect(await saveCardSummary(cardInput)).toEqual({ kind });
      expect(rpc).toHaveBeenCalledExactlyOnceWith("save_card_summary", {
        p_user_id: cardInput.userId, p_card_id: cardInput.cardId, p_period: cardInput.period,
        p_plan: cardInput.plan, p_model: cardInput.model, p_input_hash: cardInput.inputHash,
        p_summary: cardInput.summary, p_tips: cardInput.tips,
      });
    },
  );

  it.each([null, {}, { kind: "unknown" }])("rejects unknown or malformed result kinds: %j", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    const error = await saveCardSummary(cardInput).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StoreError);
    expect(error).toMatchObject({ operation: "save_card_summary", code: "unexpected_response" });
  });

  it("keeps only the RPC error code", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "private-value", details: "private-value" } });
    const error = await saveCardSummary(cardInput).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ operation: "save_card_summary", code: "PGRST202" });
    expect(String(error)).not.toContain("private-value");
  });
});
