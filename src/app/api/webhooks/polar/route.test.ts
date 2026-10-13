import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionUser } from "@/lib/auth";
import { defaultBillingDeps, type BillingDeps } from "@/lib/billing/deps";
import { syncFromPolar } from "@/lib/billing/sync";
import { getPolarWebhookSecret } from "@/lib/env";
import { checkMutationRequest } from "@/lib/http";
import { getMode } from "@/lib/mode";
import { parsePolarWebhook } from "@/services/polar/webhook";
import { POST } from "./route";

vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/billing/deps", () => ({ defaultBillingDeps: vi.fn() }));
vi.mock("@/lib/billing/sync", () => ({ syncFromPolar: vi.fn() }));
vi.mock("@/lib/env", () => ({ getPolarWebhookSecret: vi.fn() }));
vi.mock("@/lib/http", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/http")>(), checkMutationRequest: vi.fn(),
}));
vi.mock("@/lib/mode", () => ({ getMode: vi.fn() }));
vi.mock("@/services/polar/webhook", () => ({ parsePolarWebhook: vi.fn() }));

const userId = "11111111-1111-4111-8111-111111111111";
const body = '{\n  "type": "customer.state_changed", "data": {"external_id": "PRIVATE_BODY", "plan": "pro"}\n}\n';
const signature = "PRIVATE_SIGNATURE";
const secret = "PRIVATE_SECRET";
const deps: BillingDeps = {
  mode: "live", origin: "http://localhost:3000", now: () => new Date("2026-10-13T06:00:00Z"),
  gateway: vi.fn(), saveSubscription: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getMode).mockReturnValue("live");
  vi.mocked(getPolarWebhookSecret).mockReturnValue(secret);
  vi.mocked(parsePolarWebhook).mockResolvedValue({ kind: "state_changed", externalCustomerId: userId });
  vi.mocked(defaultBillingDeps).mockReturnValue(deps);
  vi.mocked(syncFromPolar).mockResolvedValue({ kind: "synced", subscription: { plan: "free", currentPeriodEnd: null, cancelAtPeriodEnd: false } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  expect(getSessionUser).not.toHaveBeenCalled();
  expect(checkMutationRequest).not.toHaveBeenCalled();
  const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
  for (const sensitive of [body, "PRIVATE_BODY", signature, secret, "PRIVATE_ERROR"]) expect(logs).not.toContain(sensitive);
  vi.restoreAllMocks();
});

function webhookRequest(origin: string | null = null, contentType: string | null = null): Request {
  const headers = new Headers({ "webhook-signature": signature, "webhook-id": "test-webhook", "webhook-timestamp": "1234567890" });
  if (origin !== null) headers.set("origin", origin);
  if (contentType !== null) headers.set("content-type", contentType);
  const request = new Request("http://localhost:3000/api/webhooks/polar", { method: "POST", headers, body });
  if (contentType === null) request.headers.delete("content-type");
  return request;
}

describe("POST /api/webhooks/polar", () => {
  it("returns 404 in mock mode before reading the body, secret or dependencies", async () => {
    vi.mocked(getMode).mockReturnValue("mock");
    const request = webhookRequest();
    const text = vi.spyOn(request, "text");
    const response = await POST(request);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND" } });
    expect(text).not.toHaveBeenCalled();
    expect(getPolarWebhookSecret).not.toHaveBeenCalled();
    expect(parsePolarWebhook).not.toHaveBeenCalled();
    expect(defaultBillingDeps).not.toHaveBeenCalled();
    expect(syncFromPolar).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([[null, null], ["https://evil.example", "text/plain"]] as const)(
    "uses unchanged text and signature without checking Origin %s or content type %s", async (origin, contentType) => {
      const request = webhookRequest(origin, contentType);
      const text = vi.spyOn(request, "text");
      const json = vi.spyOn(request, "json");
      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });
      expect(text).toHaveBeenCalledExactlyOnceWith();
      expect(json).not.toHaveBeenCalled();
      expect(parsePolarWebhook).toHaveBeenCalledExactlyOnceWith(body, request.headers, secret);
      expect(defaultBillingDeps).toHaveBeenCalledExactlyOnceWith();
      expect(syncFromPolar).toHaveBeenCalledExactlyOnceWith(userId, deps);
      expect(vi.mocked(parsePolarWebhook).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(syncFromPolar).mock.invocationCallOrder[0]);
      expect(console.error).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["invalid_signature", 403, "FORBIDDEN"],
    ["invalid_payload", 400, "BAD_REQUEST"],
  ] as const)("maps %s without synchronization or payload logs", async (kind, status, code) => {
    vi.mocked(parsePolarWebhook).mockResolvedValue({ kind });
    const response = await POST(webhookRequest());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
    expect(defaultBillingDeps).not.toHaveBeenCalled();
    expect(syncFromPolar).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(`billing:webhook:${kind}`, "-");
  });

  it("acknowledges ignored events without sync or logs", async () => {
    vi.mocked(parsePolarWebhook).mockResolvedValue({ kind: "ignored" });
    const response = await POST(webhookRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(defaultBillingDeps).not.toHaveBeenCalled();
    expect(syncFromPolar).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([null, "", "not-a-uuid", "PRIVATE_BODY", `${userId}/other`, ` ${userId} `])(
    "acknowledges missing or non-UUID customer id %s without synchronization", async (externalCustomerId) => {
      vi.mocked(parsePolarWebhook).mockResolvedValue({ kind: "state_changed", externalCustomerId });
      const response = await POST(webhookRequest());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });
      expect(defaultBillingDeps).not.toHaveBeenCalled();
      expect(syncFromPolar).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    },
  );

  it("acknowledges events for deleted users", async () => {
    vi.mocked(syncFromPolar).mockResolvedValue({ kind: "user_not_found" });
    const response = await POST(webhookRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(syncFromPolar).toHaveBeenCalledExactlyOnceWith(userId, deps);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("returns 503 on failed synchronization so Polar can retry", async () => {
    vi.mocked(syncFromPolar).mockResolvedValue({ kind: "failed" });
    const response = await POST(webhookRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
    expect(console.error).toHaveBeenCalledExactlyOnceWith("billing:webhook:failed", userId);
  });

  it("returns 500 with only the configuration code when the secret is unavailable", async () => {
    vi.mocked(getPolarWebhookSecret).mockImplementation(() => { throw new Error(`PRIVATE_ERROR ${secret}`); });
    const response = await POST(webhookRequest());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
    expect(parsePolarWebhook).not.toHaveBeenCalled();
    expect(defaultBillingDeps).not.toHaveBeenCalled();
    expect(syncFromPolar).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("billing:webhook:secret_missing");
  });

  it("returns 500 for parser exceptions without logging the exception", async () => {
    vi.mocked(parsePolarWebhook).mockRejectedValue(new Error(`PRIVATE_ERROR ${body} ${signature}`));
    const response = await POST(webhookRequest());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
    expect(defaultBillingDeps).not.toHaveBeenCalled();
    expect(syncFromPolar).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("billing:webhook:parse_failed", "-");
  });

  it("returns 500 if the raw body cannot be read", async () => {
    const request = webhookRequest();
    vi.spyOn(request, "text").mockRejectedValue(new Error(`PRIVATE_ERROR ${signature}`));
    const response = await POST(request);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
    expect(parsePolarWebhook).not.toHaveBeenCalled();
    expect(syncFromPolar).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("billing:webhook:parse_failed", "-");
  });

  it.each(["deps", "sync"] as const)("returns 503 if %s unexpectedly throws", async (operation) => {
    const error = new Error(`PRIVATE_ERROR ${signature}`);
    if (operation === "deps") vi.mocked(defaultBillingDeps).mockImplementation(() => { throw error; });
    if (operation === "sync") vi.mocked(syncFromPolar).mockRejectedValue(error);
    const response = await POST(webhookRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
    expect(console.error).toHaveBeenCalledExactlyOnceWith("billing:webhook:failed", userId);
  });
});
