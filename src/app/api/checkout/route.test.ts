import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionUser } from "@/lib/auth";
import { startCheckout } from "@/lib/billing/checkout";
import { defaultBillingDeps, type BillingDeps } from "@/lib/billing/deps";
import { getSubscription } from "@/lib/queries/subscriptions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UPGRADE_SOURCES, type StoredSubscription } from "@/types/billing";
import { POST } from "./route";

vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/billing/checkout", () => ({ startCheckout: vi.fn() }));
vi.mock("@/lib/billing/deps", () => ({ defaultBillingDeps: vi.fn() }));
vi.mock("@/lib/queries/subscriptions", () => ({ getSubscription: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

const userId = "11111111-1111-4111-8111-111111111111";
const checkoutUrl = "https://polar.test/checkout/session-user";
const stored: StoredSubscription = { plan: "free", currentPeriodEnd: null, cancelAtPeriodEnd: false };
const supabase = {} as SupabaseClient;
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
  vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase);
  vi.mocked(getSubscription).mockResolvedValue(stored);
  vi.mocked(defaultBillingDeps).mockReturnValue(deps);
  vi.mocked(startCheckout).mockResolvedValue(checkoutUrl);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function checkoutRequest({
  origin = "http://localhost:3000", contentType = "application/json", body = '{"source":"teaser"}',
  forwardedFor = "203.0.113.5, 10.0.0.1",
}: { origin?: string | null; contentType?: string | null; body?: string; forwardedFor?: string | null } = {}): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  if (contentType !== null) headers.set("content-type", contentType);
  if (forwardedFor !== null) headers.set("x-forwarded-for", forwardedFor);
  const request = new Request("http://localhost:3000/api/checkout", { method: "POST", headers, body });
  if (contentType === null) request.headers.delete("content-type");
  return request;
}

function expectNoBillingCalls() {
  expect(createSupabaseServerClient).not.toHaveBeenCalled();
  expect(getSubscription).not.toHaveBeenCalled();
  expect(defaultBillingDeps).not.toHaveBeenCalled();
  expect(startCheckout).not.toHaveBeenCalled();
}

describe("POST /api/checkout", () => {
  it("returns 401 before inspecting Origin, content type or body", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const request = checkoutRequest({ origin: null, contentType: "text/plain", body: "{" });
    const json = vi.spyOn(request, "json");
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHORIZED" } });
    expect(response.headers.has("location")).toBe(false);
    expect(json).not.toHaveBeenCalled();
    expectNoBillingCalls();
  });

  it.each([null, "null", "https://evil.example", "http://localhost:3000/"])(
    "returns 403 for Origin %s before content type or body", async (origin) => {
      const request = checkoutRequest({ origin, contentType: "text/plain", body: "{" });
      const json = vi.spyOn(request, "json");
      const response = await POST(request);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: { code: "FORBIDDEN" } });
      expect(json).not.toHaveBeenCalled();
      expectNoBillingCalls();
    },
  );

  it.each([null, "text/plain", "multipart/form-data", "application/jsonp"])(
    "returns 400 for content type %s before reading the body", async (contentType) => {
      const request = checkoutRequest({ contentType });
      const json = vi.spyOn(request, "json");
      const response = await POST(request);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST" } });
      expect(json).not.toHaveBeenCalled();
      expectNoBillingCalls();
    },
  );

  it.each(["{", "null", "[]", "{}", '{"source":"banner"}', '{"source":123}'])(
    "rejects malformed or invalid JSON %s", async (body) => {
      const response = await POST(checkoutRequest({ body }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST" } });
      expectNoBillingCalls();
    },
  );

  it.each(UPGRADE_SOURCES)("returns JSON URL and forwards only session identity for %s", async (source) => {
    const body = JSON.stringify({ source, userId: "untrusted", user_id: "untrusted", plan: "pro", customerId: "untrusted" });
    const response = await POST(checkoutRequest({ body, contentType: "Application/JSON; charset=utf-8" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: checkoutUrl });
    expect(response.headers.has("location")).toBe(false);
    expect(createSupabaseServerClient).toHaveBeenCalledExactlyOnceWith();
    expect(getSubscription).toHaveBeenCalledExactlyOnceWith(supabase, userId);
    expect(defaultBillingDeps).toHaveBeenCalledExactlyOnceWith();
    expect(startCheckout).toHaveBeenCalledExactlyOnceWith({ userId, source, customerIp: "203.0.113.5", stored }, deps);
    expect(vi.mocked(getSessionUser).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(getSubscription).mock.invocationCallOrder[0]);
    expect(vi.mocked(getSubscription).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(startCheckout).mock.invocationCallOrder[0]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([null, "::ffff:127.0.0.1"])("passes null customer IP for %s", async (forwardedFor) => {
    const response = await POST(checkoutRequest({ forwardedFor }));
    expect(response.status).toBe(200);
    expect(startCheckout).toHaveBeenCalledExactlyOnceWith({ userId, source: "teaser", customerIp: null, stored }, deps);
  });

  it.each([null, { plan: "pro", currentPeriodEnd: "2026-11-13T00:00:00Z", cancelAtPeriodEnd: false }] as const)(
    "forwards stored state unchanged and returns the billing URL: %j", async (subscription) => {
      vi.mocked(getSubscription).mockResolvedValue(subscription);
      vi.mocked(startCheckout).mockResolvedValue("https://polar.test/portal/session-user");
      const response = await POST(checkoutRequest());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ url: "https://polar.test/portal/session-user" });
      expect(startCheckout).toHaveBeenCalledExactlyOnceWith({ userId, source: "teaser", customerIp: "203.0.113.5", stored: subscription }, deps);
    },
  );

  it.each(["client", "subscription", "deps", "checkout"] as const)("returns 503 and logs only class and id on %s failure", async (operation) => {
    const error = new TypeError("PRIVATE_BILLING_ERROR_MESSAGE");
    if (operation === "client") vi.mocked(createSupabaseServerClient).mockRejectedValue(error);
    if (operation === "subscription") vi.mocked(getSubscription).mockRejectedValue(error);
    if (operation === "deps") vi.mocked(defaultBillingDeps).mockImplementation(() => { throw error; });
    if (operation === "checkout") vi.mocked(startCheckout).mockRejectedValue(error);
    const response = await POST(checkoutRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
    expect(console.error).toHaveBeenCalledExactlyOnceWith("billing:checkout:TypeError", userId);
    if (operation !== "checkout") expect(startCheckout).not.toHaveBeenCalled();
  });

  it("returns 503 for a session failure without invoking billing", async () => {
    vi.mocked(getSessionUser).mockRejectedValue(new Error("PRIVATE_AUTH_ERROR"));
    const response = await POST(checkoutRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
    expectNoBillingCalls();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("billing:checkout:Error", "-");
  });
});
