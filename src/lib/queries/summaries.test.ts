import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { QueryError } from "./query-error";
import { getStoredSummary } from "./summaries";

function fakeClient(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  const from = vi.fn(() => builder);
  return { client: { from } as unknown as SupabaseClient, from, builder };
}

describe("getStoredSummary", () => {
  it("selects only the summary fields and scopes the supplied user and month", async () => {
    const { client, from, builder } = fakeClient({ input_hash: "a".repeat(64), summary: "이번 달은 식비 비중이 커요." });
    expect(await getStoredSummary(client, "user-a", "2026-09")).toEqual({
      inputHash: "a".repeat(64), summary: "이번 달은 식비 비중이 커요.",
    });
    expect(from).toHaveBeenCalledExactlyOnceWith("ai_summaries");
    expect(builder.select).toHaveBeenCalledExactlyOnceWith("input_hash, summary");
    expect(builder.eq).toHaveBeenNthCalledWith(1, "user_id", "user-a");
    expect(builder.eq).toHaveBeenNthCalledWith(2, "month", "2026-09");
    expect(builder.maybeSingle).toHaveBeenCalledExactlyOnceWith();
  });

  it("returns null when no summary exists and strips unrelated columns", async () => {
    expect(await getStoredSummary(fakeClient(null).client, "user-a", "2026-09")).toBeNull();
    expect(await getStoredSummary(fakeClient({
      input_hash: "b".repeat(64), summary: "요약", plan: "pro", merchant: "private-value",
    }).client, "user-a", "2026-09")).toEqual({ inputHash: "b".repeat(64), summary: "요약" });
  });

  it.each([
    undefined, {}, { input_hash: "A".repeat(64), summary: "요약" }, { input_hash: "short", summary: "요약" },
    { input_hash: "c".repeat(64), summary: "" }, { input_hash: "c".repeat(64), summary: 2 },
  ])("rejects malformed rows as QueryError: %#", async (data) => {
    const error = await getStoredSummary(fakeClient(data).client, "user-a", "2026-09").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueryError);
    expect(error).toMatchObject({ operation: "getStoredSummary", code: "unexpected_response" });
  });

  it("keeps only the database error code", async () => {
    const error = await getStoredSummary(fakeClient(null, {
      code: "PGRST205", message: "private-value", details: "private-value", hint: "private-value",
    }).client, "user-a", "2026-09").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueryError);
    expect(error).toMatchObject({ operation: "getStoredSummary", code: "PGRST205" });
    expect(String(error)).not.toContain("private-value");
    expect(JSON.stringify(error)).not.toContain("private-value");
  });

  it("sanitizes rejected query promises", async () => {
    const { client, builder } = fakeClient(null);
    builder.maybeSingle.mockRejectedValue(new Error("private-value"));
    await expect(getStoredSummary(client, "user-a", "2026-09"))
      .rejects.toThrow(/^query:getStoredSummary:unexpected_response$/);
  });
});
