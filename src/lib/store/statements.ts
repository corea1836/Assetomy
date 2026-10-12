import "server-only";
import { encryptStatement } from "@/lib/crypto";
import { getFileEncryptionKey } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { StoreError } from "./store-error";

export const STATEMENTS_BUCKET = "statements";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function statementPath(userId: string, uploadId: string): string {
  if ([userId, uploadId].some((id) => id.length !== 36 || !UUID_PATTERN.test(id))) {
    throw new Error("invalid_statement_path");
  }
  return `${userId}/${uploadId}.enc`;
}

export async function saveStatement(
  userId: string, uploadId: string, plaintext: Uint8Array,
): Promise<void> {
  const path = statementPath(userId, uploadId);
  const payload = encryptStatement(plaintext, getFileEncryptionKey(), path);
  const storage = createSupabaseAdminClient().storage.from(STATEMENTS_BUCKET);
  try {
    const { error } = await storage.upload(path, payload, {
      contentType: "application/octet-stream", upsert: false,
    });
    if (error) throw new StoreError("statements.upload", error.statusCode || error.name);
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError("statements.upload", "unexpected_response");
  }
}

export async function removeStatements(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  for (const path of paths) {
    const parts = path.split("/");
    if (parts.length !== 2 || path !== statementPath(parts[0], parts[1].slice(0, -4))) {
      throw new Error("invalid_statement_path");
    }
  }

  const storage = createSupabaseAdminClient().storage.from(STATEMENTS_BUCKET);
  try {
    const { error } = await storage.remove(paths);
    if (error) throw new StoreError("statements.remove", error.statusCode || error.name);
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError("statements.remove", "unexpected_response");
  }
}
