import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { listCards } from "./cards";

function fakeClient(pages: unknown[]) {
  const builder = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    range: vi.fn(async () => ({ data: pages.shift(), error: null })),
  };
  const from = vi.fn(() => builder);
  return { client: { from } as unknown as SupabaseClient, from, builder };
}

function card(index: number) {
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, label: `카드 ${index}` };
}

describe("listCards", () => {
  it("reads beyond 1000 rows, explicitly scopes every page, and orders deterministically", async () => {
    const first = Array.from({ length: 1000 }, (_, index) => card(index));
    const last = [card(1000)];
    const { client, from, builder } = fakeClient([first, last]);
    expect(await listCards(client, "user-a")).toEqual([...first, ...last]);
    expect(from.mock.calls).toEqual([["cards"], ["cards"]]);
    expect(builder.eq.mock.calls).toEqual([["user_id", "user-a"], ["user_id", "user-a"]]);
    expect(builder.order.mock.calls).toEqual([
      ["created_at", { ascending: true }], ["id", { ascending: true }],
      ["created_at", { ascending: true }], ["id", { ascending: true }],
    ]);
    expect(builder.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it("reads an empty final page when the row count is exactly 1000", async () => {
    const { client, builder } = fakeClient([Array.from({ length: 1000 }, (_, index) => card(index)), []]);
    expect(await listCards(client, "user-a")).toHaveLength(1000);
    expect(builder.range).toHaveBeenCalledTimes(2);
  });

  it("returns an empty list when there are no cards", async () => {
    expect(await listCards(fakeClient([[]]).client, "user-a")).toEqual([]);
  });

  it.each([null, {}, [{ id: "invalid", label: "카드" }], [{ ...card(0), label: 123 }]])(
    "rejects malformed responses: %j", async (data) => {
      await expect(listCards(fakeClient([data]).client, "user-a"))
        .rejects.toMatchObject({ operation: "listCards", code: "unexpected_response" });
    },
  );
});
