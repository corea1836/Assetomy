import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { findMerchantCategories } from "./merchant-categories";

function fakeClient(pages: Record<string, unknown[]> = {}) {
  const builders: { table: string; eq: ReturnType<typeof vi.fn>; in: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>; range: ReturnType<typeof vi.fn> }[] = [];
  const from = vi.fn((table: string) => {
    const builder = {
      table, select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      range: vi.fn(async () => ({ data: pages[table]?.length ? pages[table].shift() : [], error: null })),
    };
    builders.push(builder);
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, from, builders };
}

describe("findMerchantCategories", () => {
  it("deduplicates 250 input keys and queries at most 100 unique keys per request", async () => {
    const uniqueKeys = Array.from({ length: 225 }, (_, index) => `가맹점${index}`);
    const keys = [...uniqueKeys, ...uniqueKeys.slice(0, 25)];
    expect(keys).toHaveLength(250);
    const { client, builders } = fakeClient();
    expect(await findMerchantCategories(client, "user-a", keys)).toEqual(new Map());
    for (const table of ["merchant_category_overrides", "transactions"]) {
      const queries = builders.filter((builder) => builder.table === table);
      expect(queries).toHaveLength(3);
      expect(queries.map((builder) => builder.in.mock.calls[0][1])).toEqual([
        uniqueKeys.slice(0, 100), uniqueKeys.slice(100, 200), uniqueKeys.slice(200),
      ]);
      for (const builder of queries) {
        expect(builder.in.mock.calls[0][0]).toBe("merchant_key");
        expect(builder.eq).toHaveBeenCalledExactlyOnceWith("user_id", "user-a");
        expect(builder.range).toHaveBeenCalledExactlyOnceWith(0, 999);
      }
    }
  });

  it("does not call the client for an empty key list", async () => {
    const { client, from } = fakeClient();
    expect(await findMerchantCategories(client, "user-a", [])).toEqual(new Map());
    expect(from).not.toHaveBeenCalled();
  });

  it("prioritizes overrides and takes the latest transaction category for remaining keys", async () => {
    const { client, builders } = fakeClient({
      merchant_category_overrides: [[{ merchant_key: "Y", category: "shopping" }]],
      transactions: [[{ merchant_key: "X", category: "food" }, { merchant_key: "X", category: "etc" }]],
    });
    expect(await findMerchantCategories(client, "user-a", ["X", "Y", "unknown"]))
      .toEqual(new Map([["Y", "shopping"], ["X", "food"]]));
    const transactions = builders.find((builder) => builder.table === "transactions")!;
    expect(transactions.in).toHaveBeenCalledExactlyOnceWith("merchant_key", ["X", "unknown"]);
    expect(transactions.order.mock.calls).toEqual([
      ["created_at", { ascending: false }], ["id", { ascending: false }],
    ]);
    for (const builder of builders) expect(builder.eq).toHaveBeenCalledWith("user_id", "user-a");
  });

  it("skips the transaction query when all requested keys have overrides", async () => {
    const { client, from } = fakeClient({ merchant_category_overrides: [[{ merchant_key: "X", category: "food" }]] });
    expect(await findMerchantCategories(client, "user-a", ["X", "X"])).toEqual(new Map([["X", "food"]]));
    expect(from).toHaveBeenCalledExactlyOnceWith("merchant_category_overrides");
  });

  it("reads past 1000 transaction rows without replacing a newer category", async () => {
    const { client, builders } = fakeClient({
      transactions: [
        Array.from({ length: 1000 }, () => ({ merchant_key: "X", category: "food" })),
        [{ merchant_key: "X", category: "etc" }, { merchant_key: "Y", category: "cafe" }],
      ],
    });
    expect(await findMerchantCategories(client, "user-a", ["X", "Y"]))
      .toEqual(new Map([["X", "food"], ["Y", "cafe"]]));
    const queries = builders.filter((builder) => builder.table === "transactions");
    expect(queries).toHaveLength(2);
    expect(queries.map((builder) => builder.range.mock.calls[0])).toEqual([[0, 999], [1000, 1999]]);
    for (const builder of builders) expect(builder.eq).toHaveBeenCalledWith("user_id", "user-a");
  });

  it.each(["merchant_category_overrides", "transactions"])("validates %s rows", async (table) => {
    for (const data of [null, {}, [{ merchant_key: "X", category: "invalid" }], [{ merchant_key: 123, category: "food" }]]) {
      const { client } = fakeClient({ [table]: [data] });
      await expect(findMerchantCategories(client, "user-a", ["X"]))
        .rejects.toMatchObject({ operation: "findMerchantCategories", code: "unexpected_response" });
    }
  });
});
