import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionUser } from "@/lib/auth";
import { setMerchantCategory } from "@/lib/store/merchant-categories";
import { CATEGORY_IDS } from "@/types/category";
import { PUT } from "./route";

vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/store/merchant-categories", () => ({ setMerchantCategory: vi.fn() }));

const userId = "11111111-1111-4111-8111-111111111111";
const merchantKey = "PRIVATE_MERCHANT_KEY";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  vi.mocked(getSessionUser).mockResolvedValue({ id: userId });
  vi.mocked(setMerchantCategory).mockResolvedValue({ kind: "updated", updated: 2 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function categoryRequest({
  origin = "http://localhost:3000", contentType = "application/json", body = JSON.stringify({ merchantKey, category: "food" }),
}: { origin?: string | null; contentType?: string | null; body?: string } = {}): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  if (contentType !== null) headers.set("content-type", contentType);
  const request = new Request("http://localhost:3000/api/merchant-categories", { method: "PUT", headers, body });
  if (contentType === null) request.headers.delete("content-type");
  return request;
}

describe("PUT /api/merchant-categories", () => {
  it("returns 401 before inspecting Origin, content type or body", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const request = categoryRequest({ origin: null, contentType: "text/plain", body: "{" });
    const json = vi.spyOn(request, "json");
    const response = await PUT(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHORIZED" } });
    expect(response.headers.has("location")).toBe(false);
    expect(json).not.toHaveBeenCalled();
    expect(setMerchantCategory).not.toHaveBeenCalled();
  });

  it.each([null, "null", "https://evil.example", "http://localhost:3000/"])(
    "returns 403 for Origin %s before inspecting content type or body", async (origin) => {
      const request = categoryRequest({ origin, contentType: "text/plain", body: "{" });
      const json = vi.spyOn(request, "json");
      const response = await PUT(request);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: { code: "FORBIDDEN" } });
      expect(json).not.toHaveBeenCalled();
      expect(setMerchantCategory).not.toHaveBeenCalled();
    },
  );

  it.each([null, "text/plain", "multipart/form-data", "application/jsonp"])(
    "returns 400 for content type %s before reading the body", async (contentType) => {
      const request = categoryRequest({ contentType });
      const json = vi.spyOn(request, "json");
      const response = await PUT(request);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST" } });
      expect(json).not.toHaveBeenCalled();
      expect(setMerchantCategory).not.toHaveBeenCalled();
    },
  );

  it.each([
    "{", "null", "[]", "{}", '{"merchantKey":"","category":"food"}',
    JSON.stringify({ merchantKey: "X".repeat(201), category: "food" }),
    JSON.stringify({ merchantKey, category: "unknown" }),
    JSON.stringify({ merchantKey, category: null }),
    JSON.stringify({ merchantKey }),
    '{"category":"food"}', '{"merchantKey":123,"category":"food"}',
  ])("rejects malformed or invalid JSON %s without invoking the store", async (body) => {
    const response = await PUT(categoryRequest({ body }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST" } });
    expect(setMerchantCategory).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(CATEGORY_IDS)("returns 200 with updated count and forwards only session identity for %s", async (category) => {
    const body = JSON.stringify({ merchantKey, category, userId: "untrusted", user_id: "untrusted", updated: 999 });
    const response = await PUT(categoryRequest({ body, contentType: "Application/JSON; charset=utf-8" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 2 });
    expect(setMerchantCategory).toHaveBeenCalledExactlyOnceWith(userId, merchantKey, category);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([1, 200])("accepts a merchantKey of %i characters without changing it", async (length) => {
    const key = "가".repeat(length);
    const response = await PUT(categoryRequest({ body: JSON.stringify({ merchantKey: key, category: "etc" }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 2 });
    expect(setMerchantCategory).toHaveBeenCalledExactlyOnceWith(userId, key, "etc");
  });

  it("returns 404 when the session user has no matching merchant", async () => {
    vi.mocked(setMerchantCategory).mockResolvedValue({ kind: "not_found" });
    const response = await PUT(categoryRequest());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND" } });
    expect(setMerchantCategory).toHaveBeenCalledExactlyOnceWith(userId, merchantKey, "food");
  });

  it.each([
    { error: new TypeError(`PRIVATE_ERROR_MESSAGE ${merchantKey}`), className: "TypeError" },
    { error: `PRIVATE_ERROR_MESSAGE ${merchantKey}`, className: "unknown" },
  ])("returns 503 and logs only class and session id on a $className store failure", async ({ error, className }) => {
    vi.mocked(setMerchantCategory).mockRejectedValue(error);
    const response = await PUT(categoryRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
    expect(console.error).toHaveBeenCalledExactlyOnceWith(`merchant_categories:${className}`, userId);
  });

  it("returns 503 on a session failure without invoking the store or leaking the error", async () => {
    vi.mocked(getSessionUser).mockRejectedValue(new Error(`PRIVATE_AUTH_ERROR ${merchantKey}`));
    const response = await PUT(categoryRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
    expect(setMerchantCategory).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("merchant_categories:Error", "-");
  });
});
