import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { QueryError } from "./query-error";
import { getStoredCardSummary, getStoredSummary } from "./summaries";

function fakeClient(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  const from = vi.fn(() => builder);
  return { client: { from } as unknown as SupabaseClient, from, builder };
}

const row = {
  input_hash: "a".repeat(64), summary: "이번 달은 식비 비중이 커요.", tips: ["식비 예산을 정해 보세요."],
  tip_categories: ["food"],
};
const stored = {
  inputHash: "a".repeat(64), summary: "이번 달은 식비 비중이 커요.", tips: ["식비 예산을 정해 보세요."],
  tipCategories: ["food"],
};

describe("getStoredSummary", () => {
  it("selects the summary fields including tip categories and scopes the user and month", async () => {
    const { client, from, builder } = fakeClient(row);
    expect(await getStoredSummary(client, "user-a", "2026-09")).toEqual(stored);
    expect(from).toHaveBeenCalledExactlyOnceWith("ai_summaries");
    expect(builder.select).toHaveBeenCalledExactlyOnceWith("input_hash, summary, tips, tip_categories");
    expect(builder.eq).toHaveBeenNthCalledWith(1, "user_id", "user-a");
    expect(builder.eq).toHaveBeenNthCalledWith(2, "month", "2026-09");
    expect(builder.maybeSingle).toHaveBeenCalledExactlyOnceWith();
  });

  it("returns null and strips unrelated columns", async () => {
    expect(await getStoredSummary(fakeClient(null).client, "user-a", "2026-09")).toBeNull();
    expect(await getStoredSummary(fakeClient({ ...row, plan: "pro", merchant: "private-value" }).client, "user-a", "2026-09"))
      .toEqual(stored);
  });

  it("reads back the most tips the summarizer and the database allow", async () => {
    const tips = ["팁 1", "팁 2", "팁 3", "팁 4", "팁 5"];
    const tip_categories = ["food", "cafe", "delivery", "transport", "shopping"];
    expect(await getStoredSummary(fakeClient({ ...row, tips, tip_categories }).client, "user-a", "2026-09"))
      .toEqual({ ...stored, tips, tipCategories: tip_categories });
  });

  it.each([
    undefined, {}, { ...row, input_hash: "A".repeat(64) }, { ...row, input_hash: "short" },
    { ...row, summary: "" }, { ...row, summary: 2 }, { ...row, summary: undefined },
    { ...row, tips: [] }, { ...row, tips: ["1", "2", "3", "4", "5", "6"], tip_categories: Array(6).fill("food") },
    { ...row, tips: [""] }, { ...row, tip_categories: ["unknown"] },
    { ...row, tips: ["팁", "팁2"], tip_categories: ["food"] },
    { ...row, tips: ["팁"], tip_categories: ["food", "cafe"] },
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

describe("getStoredCardSummary", () => {
  it("reads the card summary with all three scope conditions and tip categories", async () => {
    const { client, from, builder } = fakeClient({ ...row, input_hash: "e".repeat(64) });
    expect(await getStoredCardSummary(client, "user-a", "card-a", "2026-10-23")).toEqual({ ...stored, inputHash: "e".repeat(64) });
    expect(from).toHaveBeenCalledExactlyOnceWith("card_summaries");
    expect(builder.select).toHaveBeenCalledExactlyOnceWith("input_hash, summary, tips, tip_categories");
    expect(builder.eq.mock.calls).toEqual([
      ["user_id", "user-a"], ["card_id", "card-a"], ["period", "2026-10-23"],
    ]);
    expect(builder.maybeSingle).toHaveBeenCalledExactlyOnceWith();
  });

  it("returns null when no card summary exists", async () => {
    expect(await getStoredCardSummary(fakeClient(null).client, "user-a", "card-a", "2026-10")).toBeNull();
  });

  it("rejects invalid stored content and mismatched tip category lengths", async () => {
    const error = await getStoredCardSummary(fakeClient({ ...row, input_hash: "bad", tips: [], tip_categories: [] }).client,
      "user-a", "card-a", "2026-10").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueryError);
    expect(error).toMatchObject({ operation: "getStoredCardSummary", code: "unexpected_response" });

    const mismatch = await getStoredCardSummary(fakeClient({ ...row, tips: ["a", "b"] }).client,
      "user-a", "card-a", "2026-10").catch((caught: unknown) => caught);
    expect(mismatch).toBeInstanceOf(QueryError);
    expect(mismatch).toMatchObject({ operation: "getStoredCardSummary", code: "unexpected_response" });
  });
});
