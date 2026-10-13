import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionUser } from "@/lib/auth";
import { defaultBillingDeps, type BillingDeps } from "@/lib/billing/deps";
import { openPortal } from "@/lib/billing/portal";
import { POST } from "./route";

vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/billing/deps", () => ({ defaultBillingDeps: vi.fn() }));
vi.mock("@/lib/billing/portal", () => ({ openPortal: vi.fn() }));

const userId = "11111111-1111-4111-8111-111111111111";
const portalUrl = "https://polar.test/portal/session-user";
const deps: BillingDeps = {
  mode: "live", origin: "http://localhost:3000", now: () => new Date("2026-10-13T06:00:00Z"),
  gateway: vi.fn(), saveSubscription: vi.fn(),
  isProductionBilling: () => false, recordMetric: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  vi.mocked(getSessionUser).mockResolvedValue({ id: userId });
  vi.mocked(defaultBillingDeps).mockReturnValue(deps);
  vi.mocked(openPortal).mockResolvedValue(portalUrl);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function portalRequest({
  origin = "http://localhost:3000", contentType = "application/json", body = "{}",
}: { origin?: string | null; contentType?: string | null; body?: string } = {}): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  if (contentType !== null) headers.set("content-type", contentType);
  const request = new Request("http://localhost:3000/api/portal", { method: "POST", headers, body });
  if (contentType === null) request.headers.delete("content-type");
  return request;
}

describe("POST /api/portal", () => {
  it("returns 401 before Origin or content type checks", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const response = await POST(portalRequest({ origin: null, contentType: "text/plain" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHORIZED" } });
    expect(defaultBillingDeps).not.toHaveBeenCalled();
    expect(openPortal).not.toHaveBeenCalled();
    expect(response.headers.has("location")).toBe(false);
  });

  it.each([null, "null", "https://evil.example", "http://localhost:3000/"])("returns 403 for Origin %s", async (origin) => {
    const response = await POST(portalRequest({ origin, contentType: "text/plain" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "FORBIDDEN" } });
    expect(defaultBillingDeps).not.toHaveBeenCalled();
    expect(openPortal).not.toHaveBeenCalled();
  });

  it.each([null, "text/plain", "multipart/form-data", "application/jsonp"])("returns 400 for content type %s", async (contentType) => {
    const response = await POST(portalRequest({ contentType }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST" } });
    expect(defaultBillingDeps).not.toHaveBeenCalled();
    expect(openPortal).not.toHaveBeenCalled();
  });

  it.each(["{}", "", "{", '{"user_id":"untrusted","userId":"untrusted","plan":"pro","customerId":"untrusted"}'])(
    "returns a JSON URL using only session id without reading body %s", async (body) => {
      const request = portalRequest({ body, contentType: "application/json; charset=utf-8" });
      const json = vi.spyOn(request, "json");
      const text = vi.spyOn(request, "text");
      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ url: portalUrl });
      expect(response.headers.has("location")).toBe(false);
      expect(defaultBillingDeps).toHaveBeenCalledExactlyOnceWith();
      expect(openPortal).toHaveBeenCalledExactlyOnceWith(userId, deps);
      expect(json).not.toHaveBeenCalled();
      expect(text).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    },
  );

  it("returns 404 when the Polar customer is absent", async () => {
    vi.mocked(openPortal).mockResolvedValue(null);
    const response = await POST(portalRequest());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND" } });
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(["deps", "portal"] as const)("returns 503 and logs only class and id for %s failure", async (operation) => {
    const error = new TypeError("PRIVATE_PORTAL_ERROR_MESSAGE");
    if (operation === "deps") vi.mocked(defaultBillingDeps).mockImplementation(() => { throw error; });
    if (operation === "portal") vi.mocked(openPortal).mockRejectedValue(error);
    const response = await POST(portalRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
    expect(console.error).toHaveBeenCalledExactlyOnceWith("billing:portal:TypeError", userId);
  });

  it("returns 503 for a session failure without invoking billing", async () => {
    vi.mocked(getSessionUser).mockRejectedValue(new Error("PRIVATE_AUTH_ERROR"));
    const response = await POST(portalRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
    expect(defaultBillingDeps).not.toHaveBeenCalled();
    expect(openPortal).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("billing:portal:Error", "-");
  });
});
