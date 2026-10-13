import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getTransactionCoverage } from "./transactions";

type Response = { data?: unknown; count?: unknown; error?: { code: string } | null };

function fakeClient(responses: Response[]) {
  const builders: { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>; limit: ReturnType<typeof vi.fn> }[] = [];
  const from = vi.fn(() => {
    const response = { data: null, error: null, ...responses.shift() };
    const builder = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
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
