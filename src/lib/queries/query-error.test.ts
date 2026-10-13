import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { listCards } from "./cards";
import { findMerchantCategories } from "./merchant-categories";
import { listTransactions } from "./transactions";
import { getUploadOutcome } from "./uploads";
import { QueryError } from "./query-error";

const operations = [
  { operation: "listCards", call: (client: SupabaseClient) => listCards(client, "user-a") },
  { operation: "findMerchantCategories", call: (client: SupabaseClient) => findMerchantCategories(client, "user-a", ["X"]) },
  { operation: "getUploadOutcome", call: (client: SupabaseClient) => getUploadOutcome(client, "user-a", "22222222-2222-4222-8222-222222222222") },
  { operation: "listTransactions", call: (client: SupabaseClient) => listTransactions(client, "user-a", new Map()) },
];

function failingClient(error: unknown, reject = false): SupabaseClient {
  const builder = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockReturnThis(),
    then(resolve: (value: unknown) => unknown, rejectPromise: (reason: unknown) => unknown) {
      return (reject ? Promise.reject(error) : Promise.resolve({ data: null, error })).then(resolve, rejectPromise);
    },
  };
  return { from: vi.fn(() => builder) } as unknown as SupabaseClient;
}

describe("QueryError", () => {
  it("contains only the operation and code with a predictable message", () => {
    const error = new QueryError("listCards", "42501");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("query:listCards:42501");
    expect(String(error)).toContain("query:listCards:42501");
    expect(JSON.parse(JSON.stringify(error))).toEqual({ operation: "listCards", code: "42501" });
    expect(error).not.toHaveProperty("cause");
  });

  it.each(operations)("$operation keeps the code without leaking sensitive fields", async ({ operation, call }) => {
    const error = await call(failingClient({
      code: "42501", message: "비밀 가맹점명", details: "비밀 가맹점명", hint: "비밀 가맹점명",
    })).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(QueryError);
    expect(error).toMatchObject({ operation, code: "42501", message: `query:${operation}:42501` });
    expect((error as QueryError).message).not.toContain("비밀 가맹점명");
    expect(String(error)).not.toContain("비밀 가맹점명");
    expect(JSON.stringify(error)).not.toContain("비밀 가맹점명");
  });

  it.each(operations)("$operation handles missing error codes and rejected queries", async ({ operation, call }) => {
    await expect(call(failingClient({ code: "", message: "비밀 가맹점명" })))
      .rejects.toThrowError(`query:${operation}:unexpected_response`);
    await expect(call(failingClient(new Error("비밀 가맹점명"), true)))
      .rejects.toThrowError(`query:${operation}:unexpected_response`);
  });
});
