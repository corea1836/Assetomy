import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { QueryError } from "./query-error";
import { listStatements } from "./statements";

type Response = { data?: unknown; error?: { code: string } | null };

function fakeClient(responses: Response[]) {
  const builders: {
    select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; not: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>; range: ReturnType<typeof vi.fn>;
  }[] = [];
  const from = vi.fn(() => {
    const response = { data: null, error: null, ...responses.shift() };
    const builder = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(),
      then(resolve: (value: Response) => unknown) { return Promise.resolve(response).then(resolve); },
    };
    builders.push(builder);
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, from, builders };
}

function row(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    card_id: "11111111-1111-4111-8111-111111111111",
    statement_date: "2026-10-23",
    statement_saved_at: "2026-10-13T22:39:44+00:00",
    created_at: "2026-10-14T05:40:52+00:00",
    ...overrides,
  };
}

describe("listStatements", () => {
  it("reads every page with user, done, and statement-date filters and deterministic ordering", async () => {
    const first = Array.from({ length: 1000 }, (_, index) => row(index + 1));
    const last = [row(1001)];
    const { client, from, builders } = fakeClient([{ data: first }, { data: last }]);
    const statements = await listStatements(client, "user-a");

    expect(statements).toHaveLength(1001);
    expect(statements[0]).toEqual({
      cardId: row(1).card_id, statementDate: "2026-10-23", savedOn: "2026-10-14",
    });
    expect(from.mock.calls).toEqual([["uploads"], ["uploads"]]);
    for (const builder of builders) {
      expect(builder.select).toHaveBeenCalledExactlyOnceWith("card_id, statement_date, statement_saved_at, created_at");
      expect(builder.eq.mock.calls).toEqual([["user_id", "user-a"], ["status", "done"]]);
      expect(builder.not).toHaveBeenCalledExactlyOnceWith("statement_date", "is", null);
      expect(builder.order.mock.calls).toEqual([
        ["statement_date", { ascending: false }], ["id", { ascending: false }],
      ]);
    }
    expect(builders.map((builder) => builder.range.mock.calls[0])).toEqual([[0, 999], [1000, 1999]]);
  });

  it("checks the next page when exactly 1000 statements are returned", async () => {
    const { client, from } = fakeClient([{ data: Array.from({ length: 1000 }, (_, index) => row(index + 1)) }, { data: [] }]);
    expect(await listStatements(client, "user-a")).toHaveLength(1000);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("uses the Seoul day of the upload timestamp when PDF save time is null", async () => {
    const { client } = fakeClient([{ data: [row(1, { statement_saved_at: null })] }]);
    expect(await listStatements(client, "user-a")).toMatchObject([{ savedOn: "2026-10-14" }]);
  });

  it("caps a PDF save timestamp that is later than upload time at upload time", async () => {
    const { client } = fakeClient([{
      data: [row(1, { statement_saved_at: "2099-01-01T00:00:00+00:00", created_at: "2026-10-11T16:00:00+00:00" })],
    }]);
    expect(await listStatements(client, "user-a")).toMatchObject([{ savedOn: "2026-10-12" }]);
  });

  it.each([
    undefined, null, {}, [row(1, { statement_date: "2026-02-30" })],
    [row(1, { statement_saved_at: "2026-10-13T22:39:44" })],
    [row(1, { created_at: "2026-10-14" })],
  ])("rejects malformed response rows with a sanitized QueryError: %#", async (data) => {
    const error = await listStatements(fakeClient([{ data }]).client, "user-a").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueryError);
    expect(error).toMatchObject({ operation: "listStatements", code: "unexpected_response" });
  });

  it("keeps only the database error code", async () => {
    const error = await listStatements(fakeClient([{ error: { code: "42501", message: "private-value" } as never }]).client, "user-a")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueryError);
    expect(error).toMatchObject({ operation: "listStatements", code: "42501" });
    expect(String(error)).not.toContain("private-value");
  });
});
