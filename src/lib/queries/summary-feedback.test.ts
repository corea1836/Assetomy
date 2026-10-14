import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { QueryError } from "./query-error";
import { listSummaryFeedback } from "./summary-feedback";

function fakeClient(pages: unknown[] = [], error: unknown = null) {
  let pageIndex = 0;
  const builders: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    range: ReturnType<typeof vi.fn>;
  }[] = [];
  const from = vi.fn(() => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn(async () => {
        const data = pages[pageIndex++];
        return { data: data === undefined ? [] : data, error };
      }),
    };
    builders.push(builder);
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, from, builders };
}

describe("listSummaryFeedback", () => {
  it("maps rows by category and scopes the ordered query to the user", async () => {
    const row = { category: "cafe", body: "평일 오전 커피", user_id: "private" };
    const { client, from, builders } = fakeClient([[row, { category: "food", body: "집밥" }]]);
    expect(await listSummaryFeedback(client, "user-a")).toEqual({ cafe: "평일 오전 커피", food: "집밥" });
    expect(from).toHaveBeenCalledExactlyOnceWith("summary_feedback");
    expect(builders[0].select).toHaveBeenCalledExactlyOnceWith("category, body");
    expect(builders[0].eq).toHaveBeenCalledExactlyOnceWith("user_id", "user-a");
    expect(builders[0].order).toHaveBeenCalledExactlyOnceWith("category");
    expect(builders[0].range).toHaveBeenCalledExactlyOnceWith(0, 999);
  });

  it("returns an empty object when no feedback exists", async () => {
    expect(await listSummaryFeedback(fakeClient().client, "user-a")).toEqual({});
  });

  it("reads every page", async () => {
    const firstPage = Array.from({ length: 1000 }, () => ({ category: "food", body: "집밥" }));
    const { client, builders } = fakeClient([firstPage, [{ category: "cafe", body: "아메리카노" }]]);
    expect(await listSummaryFeedback(client, "user-a")).toEqual({ food: "집밥", cafe: "아메리카노" });
    expect(builders.map((builder) => builder.range.mock.calls[0])).toEqual([[0, 999], [1000, 1999]]);
  });

  it.each([
    null,
    {},
    [{ category: "unknown", body: "피드백" }],
    [{ category: "food", body: "" }],
    [{ category: "food", body: "x".repeat(401) }],
    [{ category: "food", body: 123 }],
  ])("rejects malformed database rows: %#", async (data) => {
    const error = await listSummaryFeedback(fakeClient([data]).client, "user-a").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueryError);
    expect(error).toMatchObject({ operation: "listSummaryFeedback", code: "unexpected_response" });
  });

  it("exposes only the database error code", async () => {
    const error = await listSummaryFeedback(fakeClient([], {
      code: "PGRST205", message: "private feedback", details: "private feedback",
    }).client, "user-a").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueryError);
    expect(error).toMatchObject({ operation: "listSummaryFeedback", code: "PGRST205" });
    expect(String(error)).not.toContain("private feedback");
  });
});
