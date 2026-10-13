import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { QueryError } from "./query-error";
import { getTransactionCoverage, listTransactions } from "./transactions";

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

type Response = { data?: unknown; count?: unknown; error?: { code: string } | null };

function fakeClient(responses: Response[]) {
  const builders: { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>; limit: ReturnType<typeof vi.fn>; range: ReturnType<typeof vi.fn> }[] = [];
  const from = vi.fn(() => {
    const response = { data: null, error: null, ...responses.shift() };
    const builder = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then(resolve: (value: Response) => unknown) { return Promise.resolve(response).then(resolve); },
    };
    builders.push(builder);
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, from, builders };
}

describe("getTransactionCoverage", () => {
  it("uses an exact head count and two ordered one-row reads without a 1000-row cap", async () => {
    const { client, from, builders } = fakeClient([
      { count: 1001 }, { data: [{ used_on: "2026-01-01" }] }, { data: [{ used_on: "2026-09-30" }] },
    ]);
    expect(await getTransactionCoverage(client, "user-a")).toEqual({ count: 1001, from: "2026-01-01", to: "2026-09-30" });
    expect(from.mock.calls).toEqual([["transactions"], ["transactions"], ["transactions"]]);
    expect(builders[0].select).toHaveBeenCalledExactlyOnceWith("id", { count: "exact", head: true });
    expect(builders[1].order).toHaveBeenCalledExactlyOnceWith("used_on", { ascending: true });
    expect(builders[2].order).toHaveBeenCalledExactlyOnceWith("used_on", { ascending: false });
    expect(builders[1].limit).toHaveBeenCalledExactlyOnceWith(1);
    expect(builders[2].limit).toHaveBeenCalledExactlyOnceWith(1);
    for (const builder of builders) expect(builder.eq).toHaveBeenCalledExactlyOnceWith("user_id", "user-a");
  });

  it("returns zero and null dates without boundary queries when the count is zero", async () => {
    const { client, from } = fakeClient([{ count: 0 }]);
    expect(await getTransactionCoverage(client, "user-a")).toEqual({ count: 0, from: null, to: null });
    expect(from).toHaveBeenCalledOnce();
  });

  it.each([null, undefined, -1, 1.5, 2 ** 53, "1001"])("rejects invalid counts: %j", async (count) => {
    await expect(getTransactionCoverage(fakeClient([{ count }]).client, "user-a"))
      .rejects.toMatchObject({ operation: "getTransactionCoverage", code: "unexpected_response" });
  });

  it.each([0, 1])("validates boundary read %i", async (index) => {
    for (const data of [null, [], [{ used_on: "2026-02-30" }], [{ used_on: "2026-9-1" }], [{ used_on: 123 }]]) {
      const boundaries = [{ data: [{ used_on: "2026-09-01" }] }, { data: [{ used_on: "2026-09-30" }] }];
      boundaries[index] = { data: data as { used_on: string }[] };
      await expect(getTransactionCoverage(fakeClient([{ count: 1 }, ...boundaries]).client, "user-a"))
        .rejects.toMatchObject({ code: "unexpected_response" });
    }
  });

  it("preserves a sanitized code from a failed boundary query", async () => {
    const { client } = fakeClient([{ count: 1 }, { error: { code: "42501" } }, { data: [{ used_on: "2026-09-01" }] }]);
    await expect(getTransactionCoverage(client, "user-a"))
      .rejects.toMatchObject({ operation: "getTransactionCoverage", code: "42501" });
  });
});

const cardId = "11111111-1111-4111-8111-111111111111";
const cardLabels = new Map([[cardId, "생활비 카드"]]);
const row = {
  id: "22222222-2222-4222-8222-222222222222", card_id: cardId, used_on: "2026-09-30",
  merchant: "예시 가맹점", merchant_key: "예시가맹점", amount: 1000, category: "food",
};

describe("listTransactions", () => {
  it("reads past 1000 rows, scopes and orders every page, and stops at a short page", async () => {
    const secondCardId = "33333333-3333-4333-8333-333333333333";
    const last = { ...row, card_id: secondCardId, used_on: "2026-10-01", amount: -500 };
    const { client, from, builders } = fakeClient([
      { data: Array.from({ length: 1000 }, () => row) }, { data: [last] },
    ]);
    const transactions = await listTransactions(client, "user-a", new Map([...cardLabels, [secondCardId, "온라인 카드"]]));
    expect(transactions).toHaveLength(1001);
    expect(transactions[0]).toEqual({
      id: row.id, cardId, cardLabel: "생활비 카드", date: "2026-09-30", merchant: row.merchant,
      merchantKey: row.merchant_key, amount: 1000, category: "food",
    });
    expect(transactions[1000]).toEqual({
      ...transactions[0], cardId: secondCardId, cardLabel: "온라인 카드", date: "2026-10-01", amount: -500,
    });
    expect(from.mock.calls).toEqual([["transactions"], ["transactions"]]);
    expect(builders.map((builder) => builder.range.mock.calls[0])).toEqual([[0, 999], [1000, 1999]]);
    for (const builder of builders) {
      expect(builder.select).toHaveBeenCalledExactlyOnceWith("id, card_id, used_on, merchant, merchant_key, amount, category");
      expect(builder.eq).toHaveBeenCalledExactlyOnceWith("user_id", "user-a");
      expect(builder.order.mock.calls).toEqual([["used_on", { ascending: true }], ["id", { ascending: true }]]);
    }
  });

  it("checks an empty next page after an exactly full page", async () => {
    const { client, from } = fakeClient([{ data: Array.from({ length: 1000 }, () => row) }, { data: [] }]);
    expect(await listTransactions(client, "user-a", cardLabels)).toHaveLength(1000);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("returns an empty list from one empty page", async () => {
    const { client, from } = fakeClient([{ data: [] }]);
    expect(await listTransactions(client, "user-a", new Map())).toEqual([]);
    expect(from).toHaveBeenCalledOnce();
  });

  it.each([0, -1000, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])("keeps safe integer amounts unchanged: %s", async (amount) => {
    const { client } = fakeClient([{ data: [{ ...row, amount }] }]);
    expect((await listTransactions(client, "user-a", cardLabels))[0].amount).toBe(amount);
  });

  it("rejects an unknown card without exposing the row or labels", async () => {
    const { client } = fakeClient([{ data: [row] }]);
    const error = await listTransactions(client, "user-a", new Map()).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(QueryError);
    expect(String(error)).toBe("Error: query:listTransactions:unknown_card");
    expect(JSON.stringify(error)).not.toContain(row.merchant);
    expect(JSON.stringify(error)).not.toContain(cardId);
  });

  it.each([
    null, {}, [{ ...row, id: "private-value" }], [{ ...row, card_id: 123 }],
    [{ ...row, used_on: "2026-02-30" }], [{ ...row, used_on: "2026-9-1" }],
    [{ ...row, used_on: new Date("2026-09-30") }], [{ ...row, amount: "1000" }],
    [{ ...row, amount: 1.5 }], [{ ...row, amount: 2 ** 53 }],
    [{ ...row, category: "private-value" }], [{ ...row, merchant: null }],
    [{ ...row, merchant: "" }], [{ ...row, merchant_key: 123 }], [{ ...row, merchant_key: "" }],
  ])("rejects malformed rows with a sanitized QueryError: %#", async (data) => {
    const error = await listTransactions(fakeClient([{ data }]).client, "user-a", cardLabels).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(QueryError);
    expect(String(error)).toBe("Error: query:listTransactions:unexpected_response");
    expect(JSON.stringify(error)).not.toContain("private-value");
    expect(JSON.stringify(error)).not.toContain(row.merchant);
  });

  it("rejects a failed second page instead of returning partial transactions", async () => {
    const { client } = fakeClient([
      { data: Array.from({ length: 1000 }, () => row) },
      { error: { code: "42501", message: "private-value", details: "private-value", hint: "private-value" } } as Response,
    ]);
    await expect(listTransactions(client, "user-a", cardLabels)).rejects.toThrow(/^query:listTransactions:42501$/);
  });

  it("sanitizes a thrown query error", async () => {
    const client = { from: () => { throw new Error("private-value"); } } as unknown as SupabaseClient;
    await expect(listTransactions(client, "user-a", cardLabels)).rejects.toThrow(/^query:listTransactions:unexpected_response$/);
  });
});
