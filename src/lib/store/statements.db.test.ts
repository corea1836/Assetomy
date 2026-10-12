import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decryptStatement } from "@/lib/crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createTestUser, deleteTestUser } from "@/lib/supabase/db-test-helpers";
import { StoreError } from "./store-error";
import { STATEMENTS_BUCKET, removeStatements, saveStatement, statementPath } from "./statements";

let userId: string | undefined;
const paths: string[] = [];
const key = randomBytes(32);
const plaintext = new Uint8Array(randomBytes(192));

beforeAll(async () => {
  vi.stubEnv("FILE_ENCRYPTION_KEY", key.toString("base64"));
  userId = (await createTestUser()).id;
});

afterAll(async () => {
  try {
    // Auth 사용자 삭제는 Storage 객체를 지우지 않으므로 원본부터 정리한다.
    try {
      await removeStatements(paths);
    } finally {
      if (userId) await deleteTestUser(userId);
    }
  } finally {
    vi.unstubAllEnvs();
  }
});

function testStatement(): { userId: string; uploadId: string; path: string } {
  if (!userId) throw new Error("db-test:statements:missing_user");
  const uploadId = randomUUID();
  const path = statementPath(userId, uploadId);
  paths.push(path);
  return { userId, uploadId, path };
}

async function downloadBytes(path: string): Promise<Uint8Array> {
  const { data, error } = await createSupabaseAdminClient().storage.from(STATEMENTS_BUCKET).download(path);
  if (error) throw new StoreError("statements.download", error.statusCode || error.name);
  return new Uint8Array(await data.arrayBuffer());
}

describe("statements against the dev Storage bucket", () => {
  it("stores encrypted bytes that decrypt only with the same path", async () => {
    const { userId, uploadId, path } = testStatement();
    await saveStatement(userId, uploadId, plaintext);
    const payload = await downloadBytes(path);

    expect(Buffer.from(payload)).not.toEqual(Buffer.from(plaintext));
    expect(Buffer.from(payload).includes(Buffer.from(plaintext.subarray(0, 64)))).toBe(false);
    expect(Buffer.from(decryptStatement(payload, key, path))).toEqual(Buffer.from(plaintext));
    expect(() => decryptStatement(payload, key, `${userId}/${randomUUID()}.enc`)).toThrowError(/^decrypt_failed$/);
  });

  it("rejects saving the same path again and preserves the original bytes", async () => {
    const { userId, uploadId, path } = testStatement();
    await saveStatement(userId, uploadId, plaintext);
    const before = await downloadBytes(path);
    const error = await saveStatement(userId, uploadId, randomBytes(192)).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(StoreError);
    expect(error).toMatchObject({ operation: "statements.upload" });
    expect(Buffer.from(await downloadBytes(path))).toEqual(Buffer.from(before));
  });

  it("removes a saved object so that downloading it fails", async () => {
    const { userId, uploadId, path } = testStatement();
    await saveStatement(userId, uploadId, plaintext);
    await removeStatements([path]);
    const { data, error } = await createSupabaseAdminClient().storage.from(STATEMENTS_BUCKET).download(path);

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});
