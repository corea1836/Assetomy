import { createHmac, randomBytes } from "node:crypto";
import { webhooks } from "@polar-sh/sdk/2026-10";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePolarWebhook } from "./webhook";

vi.mock("@polar-sh/sdk/2026-10", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@polar-sh/sdk/2026-10")>();
  // Keep real signature verification; copy the SDK's read-only namespace so individual tests can spy.
  return { ...sdk, webhooks: { ...sdk.webhooks } };
});

afterEach(() => vi.restoreAllMocks());

function signed(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const key = randomBytes(32);
  const secret = `whsec_${key.toString("base64")}`;
  const id = "test-webhook-id";
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { secret, headers: new Headers({
    "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}`,
  }) };
}

function stateChanged(externalId: string | null = "test-user") {
  return JSON.stringify({
    type: "customer.state_changed", timestamp: new Date().toISOString(), data: {
      id: "00000000-0000-4000-8000-000000000001", type: "individual", created_at: "2026-10-13T00:00:00Z",
      modified_at: null, metadata: {}, external_id: externalId, email: "customer@example.test", email_verified: false,
      name: null, billing_name: null, billing_address: null, tax_id: null,
      organization_id: "00000000-0000-4000-8000-000000000002", deleted_at: null,
      first_user_event_at: null, avatar_url: null, active_subscriptions: [], granted_benefits: [], active_meters: [],
    },
  });
}

describe("parsePolarWebhook", () => {
  it("verifies a real Standard Webhooks signature and extracts only the external id", async () => {
    const body = stateChanged();
    const { headers, secret } = signed(body);
    await expect(parsePolarWebhook(body, headers, secret)).resolves.toEqual({ kind: "state_changed", externalCustomerId: "test-user" });
  });

  it("returns a null external id", async () => {
    const body = stateChanged(null);
    const { headers, secret } = signed(body);
    await expect(parsePolarWebhook(body, headers, secret)).resolves.toEqual({ kind: "state_changed", externalCustomerId: null });
  });

  it("returns null when the optional external id is absent", async () => {
    const event = JSON.parse(stateChanged());
    delete event.data.external_id;
    const body = JSON.stringify(event);
    const { headers, secret } = signed(body);
    await expect(parsePolarWebhook(body, headers, secret)).resolves.toEqual({ kind: "state_changed", externalCustomerId: null });
  });

  it.each(["subscription.active", "future.unknown_event"])("ignores signed event %s", async (type) => {
    const body = JSON.stringify({ type, timestamp: new Date().toISOString(), data: {} });
    const { headers, secret } = signed(body);
    await expect(parsePolarWebhook(body, headers, secret)).resolves.toEqual({ kind: "ignored" });
  });

  it("rejects a one-character change to the signature", async () => {
    const body = stateChanged();
    const { headers, secret } = signed(body);
    const signature = headers.get("webhook-signature")!;
    headers.set("webhook-signature", `v1,${signature[3] === "A" ? "B" : "A"}${signature.slice(4)}`);
    await expect(parsePolarWebhook(body, headers, secret)).resolves.toEqual({ kind: "invalid_signature" });
  });

  it("rejects a different secret", async () => {
    const body = stateChanged();
    const { headers } = signed(body);
    await expect(parsePolarWebhook(body, headers, signed(body).secret)).resolves.toEqual({ kind: "invalid_signature" });
  });

  it.each(["webhook-id", "webhook-timestamp", "webhook-signature"])("rejects a missing %s header", async (name) => {
    const body = stateChanged();
    const { headers, secret } = signed(body);
    headers.delete(name);
    await expect(parsePolarWebhook(body, headers, secret)).resolves.toEqual({ kind: "invalid_signature" });
  });

  it("rejects an expired signature", async () => {
    const body = stateChanged();
    const { headers, secret } = signed(body, String(Math.floor(Date.now() / 1000) - 600));
    await expect(parsePolarWebhook(body, headers, secret)).resolves.toEqual({ kind: "invalid_signature" });
  });

  it("rejects an unknown event with an invalid signature before ignoring its type", async () => {
    const body = JSON.stringify({ type: "future.unknown_event" });
    const { headers } = signed(body);
    await expect(parsePolarWebhook(body, headers, signed(body).secret)).resolves.toEqual({ kind: "invalid_signature" });
  });

  it("reports signed invalid JSON as invalid_payload", async () => {
    const body = "{invalid-json";
    const { headers, secret } = signed(body);
    await expect(parsePolarWebhook(body, headers, secret)).resolves.toEqual({ kind: "invalid_payload" });
  });

  it.each([null, undefined, { external_id: 123 }])("reports malformed signed state data as invalid_payload: %#", async (data) => {
    const body = JSON.stringify({ type: "customer.state_changed", data });
    const { headers, secret } = signed(body);
    await expect(parsePolarWebhook(body, headers, secret)).resolves.toEqual({ kind: "invalid_payload" });
  });

  it("passes only the signature headers and substitutes empty strings for missing headers", async () => {
    const validate = vi.spyOn(webhooks, "validateEvent").mockRejectedValue(new webhooks.PolarWebhookVerificationError("private-message"));
    await parsePolarWebhook("test-body", new Headers({ "x-unrelated": "private-value" }), "test-secret");
    expect(validate).toHaveBeenCalledExactlyOnceWith("test-body", {
      "webhook-id": "", "webhook-timestamp": "", "webhook-signature": "",
    }, "test-secret");
  });

  it("propagates throws outside the SDK webhook error hierarchy", async () => {
    const error = new Error("unexpected-programming-error");
    vi.spyOn(webhooks, "validateEvent").mockRejectedValue(error);
    await expect(parsePolarWebhook("body", new Headers(), "test-secret")).rejects.toBe(error);
  });
});
