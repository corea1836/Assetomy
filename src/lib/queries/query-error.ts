import "server-only";
import type { z } from "zod";

export class QueryError extends Error {
  constructor(public readonly operation: string, public readonly code: string) {
    super(`query:${operation}:${code}`);
  }
}

// DB 응답을 검증하고 에러 원문 대신 operation·code만 전달한다.
export async function readQuery<T>(
  operation: string,
  query: () => PromiseLike<{ error: { code?: string } | null }>,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    const response = await query();
    if (response.error) throw new QueryError(operation, response.error.code || "unexpected_response");
    const result = schema.safeParse(response);
    if (!result.success) throw new QueryError(operation, "unexpected_response");
    return result.data;
  } catch (error) {
    if (error instanceof QueryError) throw error;
    throw new QueryError(operation, "unexpected_response");
  }
}
