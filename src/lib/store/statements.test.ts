import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptStatement } from "@/lib/crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { StoreError } from "./store-error";
import { STATEMENTS_BUCKET, removeStatements, saveStatement, statementPath } from "./statements";

const { upload, remove, from } = vi.hoisted(() => ({
  upload: vi.fn(), remove: vi.fn(), from: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({ storage: { from } })),
}));

const userId = "abcdefab-1234-4abc-8def-0123456789ab";
const uploadId = "12345678-9abc-4def-8123-456789abcdef";
const path = `${userId}/${uploadId}.enc`;
const plaintext = Uint8Array.from({ length: 192 }, (_, index) => index);
const invalidIds = ["../x", userId.toUpperCase(), "", "a/b", `${userId}\n`, `${userId}a`];
let key: Buffer;

beforeEach(() => {
  vi.clearAllMocks();
  upload.mockReset().mockResolvedValue({ data: { path }, error: null });
  remove.mockReset().mockResolvedValue({ data: [], error: null });
  from.mockReturnValue({ upload, remove });
  key = randomBytes(32);
  vi.stubEnv("FILE_ENCRYPTION_KEY", key.toString("base64"));
});
afterEach(() => vi.unstubAllEnvs());

describe("statementPath", () => {
  it("uses lowercase UUIDs with an enc extension", () => {
    expect(STATEMENTS_BUCKET).toBe("statements");
    expect(statementPath(userId, uploadId)).toBe(path);
  });

  it.each(invalidIds)("rejects invalid user and upload IDs: %j", (id) => {
    expect(() => statementPath(id, uploadId)).toThrowError();
    expect(() => statementPath(userId, id)).toThrowError();
  });
});

describe("saveStatement", () => {
  it("uploads only encrypted bytes once and authenticates the storage path", async () => {
    await expect(saveStatement(userId, uploadId, plaintext)).resolves.toBeUndefined();

    expect(from).toHaveBeenCalledExactlyOnceWith("statements");
    expect(upload).toHaveBeenCalledExactlyOnceWith(path, expect.any(Uint8Array), {
      contentType: "application/octet-stream", upsert: false,
    });
    const payload: Uint8Array = upload.mock.calls[0][1];
    expect(Buffer.from(payload)).not.toEqual(Buffer.from(plaintext));
    expect(Buffer.from(payload).includes(Buffer.from(plaintext.subarray(0, 64)))).toBe(false);
    expect(Buffer.from(decryptStatement(payload, key, path))).toEqual(Buffer.from(plaintext));
    expect(() => decryptStatement(payload, key, `${userId}/${userId}.enc`)).toThrowError(/^decrypt_failed$/);
  });

  it.each(invalidIds)("rejects invalid IDs before calling Storage: %j", async (id) => {
    await expect(saveStatement(id, uploadId, plaintext)).rejects.toThrowError();
    await expect(saveStatement(userId, id, plaintext)).rejects.toThrowError();
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("requires the encryption key before calling Storage", async () => {
    vi.stubEnv("FILE_ENCRYPTION_KEY", undefined);
    await expect(saveStatement(userId, uploadId, plaintext)).rejects.toThrowError(/^FILE_ENCRYPTION_KEY$/);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("removeStatements", () => {
  it("does not call Storage for an empty array", async () => {
    await expect(removeStatements([])).resolves.toBeUndefined();
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes all valid paths in one call", async () => {
    const paths = [path, `${userId}/${userId}.enc`];
    await expect(removeStatements(paths)).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledExactlyOnceWith("statements");
    expect(remove).toHaveBeenCalledExactlyOnceWith(paths);
  });

  it.each([
    ...invalidIds.map((id) => `${id}/${uploadId}.enc`),
    ...invalidIds.map((id) => `${userId}/${id}.enc`),
    `/${path}`, `${path}/extra`, `${path}\n`, `${userId}/${uploadId}.pdf`,
    `${userId}/${uploadId}`, `${userId}/${uploadId}.enc.enc`, "",
  ])("rejects a mixed array before deleting any path: %j", async (invalidPath) => {
    await expect(removeStatements([path, invalidPath])).rejects.toThrowError();
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

const operations = [
  { operation: "statements.upload", call: () => saveStatement(userId, uploadId, plaintext), mock: upload },
  { operation: "statements.remove", call: () => removeStatements([path]), mock: remove },
];
describe("Storage errors", () => {
  it.each(operations)("$operation preserves the status code without sensitive fields", async ({ operation, call, mock }) => {
    mock.mockResolvedValue({ data: null, error: {
      message: "비밀 파일명.pdf", statusCode: "409", name: "StorageApiError",
      details: "비밀 파일명.pdf", originalError: new Error("비밀 파일명.pdf"),
    } });
    const error = await call().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StoreError);
    expect(error).toMatchObject({ operation, code: "409", message: `store:${operation}:409` });
    expect(inspect(error, { showHidden: true, depth: null })).not.toContain("비밀 파일명");
    expect(JSON.stringify(error)).not.toContain("비밀 파일명");
    expect(error).not.toHaveProperty("cause");
  });

  it.each(operations)("$operation uses the Storage error name if no status code exists", async ({ operation, call, mock }) => {
    mock.mockResolvedValue({ data: null, error: { name: "StorageUnknownError", message: "비밀 파일명.pdf" } });
    await expect(call()).rejects.toMatchObject({ operation, code: "StorageUnknownError" });
  });

  it.each(operations)("$operation sanitizes a rejected Storage promise", async ({ operation, call, mock }) => {
    mock.mockRejectedValue(new Error("비밀 파일명.pdf"));
    const error = await call().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StoreError);
    expect(error).toMatchObject({ operation, code: "unexpected_response" });
    expect(inspect(error, { showHidden: true, depth: null })).not.toContain("비밀 파일명");
  });
});
