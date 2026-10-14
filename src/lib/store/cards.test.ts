import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CardUpdateInput, NewCardInput } from "@/types/card";
import { createCard, updateCard } from "./cards";
import { StoreError } from "./store-error";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => ({ rpc })) }));
beforeEach(() => { vi.clearAllMocks(); rpc.mockReset(); });
const cardId = "11111111-1111-4111-8111-111111111111";
const input: NewCardInput = { label: "생활비 카드", issuer: "hyundai", analysisBasis: "month", cycleStartDay: null };
const updateInput: CardUpdateInput = { label: "여행 카드", analysisBasis: "cycle", cycleStartDay: 12 };

describe("createCard", () => {
  it.each([
    [{ kind: "created", card_id: cardId }, { kind: "created", cardId }],
    [{ kind: "duplicate_label" }, { kind: "duplicate_label" }],
    [{ kind: "invalid_label" }, { kind: "invalid_label" }],
  ])("maps the response %j and uses exact RPC arguments", async (data, expected) => {
    rpc.mockResolvedValue({ data, error: null });
    expect(await createCard("user-a", input)).toEqual(expected);
    expect(createSupabaseAdminClient).toHaveBeenCalledExactlyOnceWith();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_card", {
      p_user_id: "user-a", p_label: "생활비 카드", p_issuer: "hyundai",
      p_analysis_basis: "month", p_cycle_start_day: null,
    });
  });

  it.each([null, { kind: "unknown" }, { kind: "created" }, { kind: "created", card_id: 42 }])(
    "rejects malformed responses without exposing them: %j", async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      await expect(createCard("user-a", input)).rejects.toMatchObject({
        code: "unexpected_response", operation: "create_card",
      });
    },
  );

  it("strips unknown response fields", async () => {
    rpc.mockResolvedValue({ data: { kind: "created", card_id: cardId, secret: "private" }, error: null });
    expect(await createCard("user-a", input)).toEqual({ kind: "created", cardId });
  });

  it.each(["23514", "PGRST202"])("keeps only the RPC error code %s", async (code) => {
    rpc.mockResolvedValue({ data: null, error: {
      code, message: "비밀 가맹점명", details: "비밀 가맹점명", hint: "비밀 가맹점명",
    } });
    const error = await createCard("user-a", input).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StoreError);
    expect(error).toMatchObject({ code, operation: "create_card", message: `store:create_card:${code}` });
    expect(String(error)).not.toContain("비밀 가맹점명");
    expect(JSON.stringify(error)).not.toContain("비밀 가맹점명");
  });

  it("sanitizes a rejected RPC promise", async () => {
    rpc.mockRejectedValue(new Error("비밀 가맹점명"));
    await expect(createCard("user-a", input)).rejects.toThrowError(
      /^store:create_card:unexpected_response$/,
    );
  });
});

describe("updateCard", () => {
  it.each(["updated", "not_found", "invalid_label", "duplicate_label"] as const)(
    "returns %s and sends exact RPC arguments", async (kind) => {
      rpc.mockResolvedValue({ data: { kind }, error: null });
      expect(await updateCard("user-a", cardId, updateInput)).toEqual({ kind });
      expect(rpc).toHaveBeenCalledExactlyOnceWith("update_card", {
        p_user_id: "user-a", p_card_id: cardId, p_label: "여행 카드",
        p_analysis_basis: "cycle", p_cycle_start_day: 12,
      });
    },
  );

  it("sends a null cycle day for monthly cards", async () => {
    rpc.mockResolvedValue({ data: { kind: "updated" }, error: null });
    await updateCard("user-a", cardId, { label: "생활비 카드", analysisBasis: "month", cycleStartDay: null });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("update_card", expect.objectContaining({ p_cycle_start_day: null }));
  });

  it.each([null, { kind: "unknown" }])(
    "rejects malformed responses without exposing them: %j", async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      const error = await updateCard("user-a", cardId, updateInput).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(StoreError);
      expect(error).toMatchObject({ operation: "update_card", code: "unexpected_response" });
      expect(String(error)).not.toContain("private");
    },
  );

  it("keeps only the RPC error code", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "private-value", details: "private-value" } });
    const error = await updateCard("user-a", cardId, updateInput).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ operation: "update_card", code: "PGRST202" });
    expect(String(error)).not.toContain("private-value");
  });
});
