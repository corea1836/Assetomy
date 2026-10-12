import "server-only";
import type { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export class StoreError extends Error {
  constructor(public readonly operation: string, public readonly code: string) {
    super(`store:${operation}:${code}`);
  }
}

// 에러 객체나 검증 실패의 원본 응답을 밖으로 전달하지 않는다.
export async function callStoreRpc<T>(
  operation: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const client = createSupabaseAdminClient();
  try {
    const { data, error } = await client.rpc(operation, args);
    if (error) throw new StoreError(operation, error.code || "unexpected_response");

    const result = schema.safeParse(data);
    if (!result.success) throw new StoreError(operation, "unexpected_response");
    return result.data;
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError(operation, "unexpected_response");
  }
}
