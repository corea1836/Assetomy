import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionUser } from "@/lib/auth";
import { recordMetric } from "@/lib/store/metrics";
import { UPGRADE_SOURCES } from "@/types/billing";
import { POST } from "./route";

vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/store/metrics", () => ({ recordMetric: vi.fn() }));

const userId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  vi.mocked(getSessionUser).mockResolvedValue({ id: userId });
  vi.mocked(recordMetric).mockResolvedValue({ kind: "recorded" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function metricRequest({
  origin = "http://localhost:3000", contentType = "application/json", body = '{"event":"teaser_seen"}',
}: { origin?: string | null; contentType?: string | null; body?: string } = {}): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  if (contentType !== null) headers.set("content-type", contentType);
  const request = new Request("http://localhost:3000/api/metrics", { method: "POST", headers, body });
  if (contentType === null) request.headers.delete("content-type");
  return request;
}

describe("POST /api/metrics", () => {
  it("returns 401 before inspecting Origin, content type or body", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const request = metricRequest({ origin: null, contentType: "text/plain", body: "{" });
    const json = vi.spyOn(request, "json");
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHORIZED" } });
    expect(response.headers.has("location")).toBe(false);
    expect(json).not.toHaveBeenCalled();
    expect(recordMetric).not.toHaveBeenCalled();
  });

  it.each([null, "null", "https://evil.example", "http://localhost:3000/"])(
    "returns 403 for Origin %s before inspecting content type or body", async (origin) => {
      const request = metricRequest({ origin, contentType: "text/plain", body: "{" });
      const json = vi.spyOn(request, "json");
      const response = await POST(request);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: { code: "FORBIDDEN" } });
      expect(json).not.toHaveBeenCalled();
      expect(recordMetric).not.toHaveBeenCalled();
    },
  );

  it.each([null, "text/plain", "multipart/form-data", "application/jsonp"])(
    "returns 400 for content type %s before reading the body", async (contentType) => {
      const request = metricRequest({ contentType });
      const json = vi.spyOn(request, "json");
      const response = await POST(request);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST" } });
      expect(json).not.toHaveBeenCalled();
      expect(recordMetric).not.toHaveBeenCalled();
    },
  );

  it.each([
    "{", "null", "[]", "{}", '{"event":"unknown"}', '{"event":123}',
    '{"event":"first_paid"}', '{"event":"first_paid","source":"teaser"}',
    '{"event":"upgrade_click"}', '{"event":"upgrade_click","source":"banner"}',
    '{"event":"upgrade_click","source":"direct"}', '{"event":"upgrade_click","source":null}',
  ])("rejects malformed or invalid JSON %s without invoking the store", async (body) => {
    const response = await POST(metricRequest({ body }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST" } });
    expect(recordMetric).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(["recorded", "unchanged"] as const)("returns 204 with no body for teaser_seen when %s", async (kind) => {
    vi.mocked(recordMetric).mockResolvedValue({ kind });
    const body = JSON.stringify({ event: "teaser_seen", userId: "untrusted", user_id: "untrusted", source: "banner" });
    const response = await POST(metricRequest({ body }));
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(await response.text()).toBe("");
    expect(recordMetric).toHaveBeenCalledExactlyOnceWith(userId, { event: "teaser_seen" });
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(UPGRADE_SOURCES)("forwards only session identity and the validated source %s", async (source) => {
    const body = JSON.stringify({ event: "upgrade_click", source, userId: "untrusted", user_id: "untrusted", extra: true });
    const response = await POST(metricRequest({ body, contentType: "Application/JSON; charset=utf-8" }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(recordMetric).toHaveBeenCalledExactlyOnceWith(userId, { event: "upgrade_click", source });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("returns 401 when the store no longer finds the session user", async () => {
    vi.mocked(recordMetric).mockResolvedValue({ kind: "user_not_found" });
    const response = await POST(metricRequest());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHORIZED" } });
    expect(recordMetric).toHaveBeenCalledExactlyOnceWith(userId, { event: "teaser_seen" });
  });

  it.each([
    { error: new TypeError("PRIVATE_ERROR_MESSAGE PRIVATE_MERCHANT_KEY"), className: "TypeError" },
    { error: "PRIVATE_ERROR_MESSAGE PRIVATE_MERCHANT_KEY", className: "unknown" },
  ])("returns 503 and logs only class and session id on a $className store failure", async ({ error, className }) => {
    vi.mocked(recordMetric).mockRejectedValue(error);
    const body = JSON.stringify({ event: "teaser_seen", merchantKey: "PRIVATE_MERCHANT_KEY" });
    const response = await POST(metricRequest({ body }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
    expect(console.error).toHaveBeenCalledExactlyOnceWith(`metrics:${className}`, userId);
    expect(recordMetric).toHaveBeenCalledExactlyOnceWith(userId, { event: "teaser_seen" });
  });

  it("returns 503 on a session failure without invoking the store or leaking the error", async () => {
    vi.mocked(getSessionUser).mockRejectedValue(new Error("PRIVATE_AUTH_ERROR"));
    const response = await POST(metricRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
    expect(recordMetric).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("metrics:Error", "-");
  });
});
