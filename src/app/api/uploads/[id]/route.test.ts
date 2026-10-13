import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionUser } from "@/lib/auth";
import { removeStatements } from "@/lib/store/statements";
import { deleteUpload } from "@/lib/store/uploads";
import { DELETE } from "./route";

vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/store/uploads", () => ({ deleteUpload: vi.fn() }));
vi.mock("@/lib/store/statements", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/store/statements")>(),
  removeStatements: vi.fn(),
}));

const userId = "11111111-1111-4111-8111-111111111111";
const uploadId = "33333333-3333-4333-8333-333333333333";
const context = (id = uploadId) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  vi.mocked(getSessionUser).mockResolvedValue({ id: userId });
  vi.mocked(deleteUpload).mockResolvedValue({ kind: "deleted" });
  vi.mocked(removeStatements).mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

function deleteRequest(origin: string | null = "http://localhost:3000"): Request {
  const headers = new Headers({ "content-type": "text/plain" });
  if (origin !== null) headers.set("origin", origin);
  return new Request(`http://localhost:3000/api/uploads/${uploadId}?user_id=untrusted&storage_path=untrusted`, {
    method: "DELETE", headers,
  });
}

describe("DELETE /api/uploads/[id]", () => {
  it("returns 401 JSON before checking Origin or id", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const response = await DELETE(deleteRequest(null), context("invalid"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHORIZED" } });
    expect(response.headers.has("location")).toBe(false);
    expect(deleteUpload).not.toHaveBeenCalled();
    expect(removeStatements).not.toHaveBeenCalled();
  });

  it.each([null, "null", "https://evil.example"])("returns 403 for Origin %s", async (origin) => {
    const response = await DELETE(deleteRequest(origin), context("invalid"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "FORBIDDEN" } });
    expect(deleteUpload).not.toHaveBeenCalled();
    expect(removeStatements).not.toHaveBeenCalled();
  });

  it("deletes with the session user, ignores content type and derives the encrypted path", async () => {
    const response = await DELETE(deleteRequest(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(deleteUpload).toHaveBeenCalledExactlyOnceWith(userId, uploadId);
    expect(removeStatements).toHaveBeenCalledExactlyOnceWith([`${userId}/${uploadId}.enc`]);
    expect(vi.mocked(deleteUpload).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(removeStatements).mock.invocationCallOrder[0]);
  });

  it("still returns 200 if encrypted file cleanup fails", async () => {
    vi.mocked(removeStatements).mockRejectedValue(new Error("PRIVATE_STORAGE_ERROR"));
    const response = await DELETE(deleteRequest(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
  });

  it.each([
    ["not_found", 404, "NOT_FOUND"],
    ["processing", 409, "UPLOAD_PROCESSING"],
  ] as const)("maps %s without touching Storage", async (kind, status, code) => {
    vi.mocked(deleteUpload).mockResolvedValue({ kind });
    const response = await DELETE(deleteRequest(), context());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
    expect(removeStatements).not.toHaveBeenCalled();
  });

  it.each(["not-a-uuid", "../other.enc", ""])("returns 404 for invalid id %s", async (id) => {
    const response = await DELETE(deleteRequest(), context(id));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND" } });
    expect(deleteUpload).not.toHaveBeenCalled();
    expect(removeStatements).not.toHaveBeenCalled();
  });

  it("returns 503 without exposing a store error", async () => {
    vi.mocked(deleteUpload).mockRejectedValue(new Error("PRIVATE_DELETE_ERROR"));
    const response = await DELETE(deleteRequest(), context());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
    expect(removeStatements).not.toHaveBeenCalled();
  });
});
