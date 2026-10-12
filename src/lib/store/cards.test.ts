import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createCard } from "./cards";
import { StoreError } from "./store-error";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => ({ rpc })) }));
beforeEach(() => { vi.clearAllMocks(); rpc.mockReset(); });
const cardId = "11111111-1111-4111-8111-111111111111";

describe("createCard", () => {
  it.each([
    [{ kind: "created", card_id: cardId }, { kind: "created", cardId }],
    [{ kind: "duplicate_label" }, { kind: "duplicate_label" }],
    [{ kind: "invalid_label" }, { kind: "invalid_label" }],
  ])("maps the response %j and uses exact RPC arguments", async (data, expected) => {
    rpc.mockResolvedValue({ data, error: null });
    expect(await createCard("user-a", "생활비 카드")).toEqual(expected);
    expect(createSupabaseAdminClient).toHaveBeenCalledExactlyOnceWith();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_card", {
      p_user_id: "user-a", p_label: "생활비 카드",
    });
  });

  it.each([null, { kind: "unknown" }, { kind: "created" }, { kind: "created", card_id: 42 }])(
    "rejects malformed responses without exposing them: %j", async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      await expect(createCard("user-a", "생활비 카드")).rejects.toMatchObject({
        code: "unexpected_response", operation: "create_card",
      });
    },
  );

  it("strips unknown response fields", async () => {
    rpc.mockResolvedValue({ data: { kind: "created", card_id: cardId, secret: "private" }, error: null });
    expect(await createCard("user-a", "생활비 카드")).toEqual({ kind: "created", cardId });
  });

  it.each(["23514", "PGRST202"])("keeps only the RPC error code %s", async (code) => {
    rpc.mockResolvedValue({ data: null, error: {
      code, message: "비밀 가맹점명", details: "비밀 가맹점명", hint: "비밀 가맹점명",
    } });
    const error = await createCard("user-a", "생활비 카드").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StoreError);
    expect(error).toMatchObject({ code, operation: "create_card", message: `store:create_card:${code}` });
    expect(String(error)).not.toContain("비밀 가맹점명");
    expect(JSON.stringify(error)).not.toContain("비밀 가맹점명");
  });

  it("sanitizes a rejected RPC promise", async () => {
    rpc.mockRejectedValue(new Error("비밀 가맹점명"));
    await expect(createCard("user-a", "생활비 카드")).rejects.toThrowError(
      /^store:create_card:unexpected_response$/,
    );
  });
});
