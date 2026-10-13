import { errors, type createPolar } from "@polar-sh/sdk/2026-10";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createPolarGateway, type PolarClient } from "./polar-gateway";
import { PolarGatewayError, type CheckoutInput } from "./types";

const proProductId = "pro-product";
const checkoutInput: CheckoutInput = {
  userId: "test-user", customerIp: "203.0.113.10",
  successUrl: "https://assetomy.test/dashboard?checkout=success",
  returnUrl: "https://assetomy.test/dashboard", source: "teaser",
};

function fakeClient() {
  const getStateExternal = vi.fn<(userId: string) => Promise<unknown>>();
  const createCheckout = vi.fn<(input: Parameters<PolarClient["checkouts"]["create"]>[0]) => Promise<unknown>>();
  const createSession = vi.fn<(input: Parameters<PolarClient["customerSessions"]["create"]>[0]) => Promise<unknown>>();
  const client = {
    customers: { getStateExternal }, checkouts: { create: createCheckout },
    customerSessions: { create: createSession },
  } as unknown as PolarClient;
  return { getStateExternal, createCheckout, createSession, gateway: createPolarGateway(client, proProductId) };
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "pro-subscription", product_id: proProductId, status: "active",
    current_period_end: "2026-11-13T14:00:00Z", cancel_at_period_end: false,
    ...overrides,
  };
}

describe("createPolarGateway", () => {
  it("accepts only the three required SDK methods", () => {
    type Client = ReturnType<typeof createPolar>;
    expectTypeOf<PolarClient>().toEqualTypeOf<{
      customers: Pick<Client["customers"], "getStateExternal">;
      checkouts: Pick<Client["checkouts"], "create">;
      customerSessions: Pick<Client["customerSessions"], "create">;
    }>();
  });

  describe("getCustomerState", () => {
    it.each([
      new errors.ResourceNotFound(404, { error: "ResourceNotFound", detail: "private-sdk-detail" }),
      { statusCode: 404, message: "private-sdk-message" },
    ])("maps SDK or status-code 404 to no_customer: %#", async (error) => {
      const { getStateExternal, gateway } = fakeClient();
      getStateExternal.mockRejectedValue(error);
      await expect(gateway.getCustomerState("test-user")).resolves.toEqual({ kind: "no_customer" });
      expect(getStateExternal).toHaveBeenCalledExactlyOnceWith("test-user");
    });

    it("maps only the three entitlement fields, preserving the timestamp", async () => {
      const { getStateExternal, gateway } = fakeClient();
      getStateExternal.mockResolvedValue({
        email: "private-customer@example.test", active_subscriptions: [subscription({ cancel_at_period_end: true })],
      });
      await expect(gateway.getCustomerState("test-user")).resolves.toEqual({
        kind: "customer", pro: {
          subscriptionId: "pro-subscription", currentPeriodEnd: "2026-11-13T14:00:00Z", cancelAtPeriodEnd: true,
        },
      });
    });

    it("returns Free for another product's active subscription", async () => {
      const { getStateExternal, gateway } = fakeClient();
      getStateExternal.mockResolvedValue({ active_subscriptions: [subscription({ product_id: "other-product" })] });
      await expect(gateway.getCustomerState("test-user")).resolves.toEqual({ kind: "customer", pro: null });
    });

    it.each(["past_due", "canceled", "trialing"])("ignores Pro status %s", async (status) => {
      const { getStateExternal, gateway } = fakeClient();
      getStateExternal.mockResolvedValue({ active_subscriptions: [subscription({ status })] });
      await expect(gateway.getCustomerState("test-user")).resolves.toEqual({ kind: "customer", pro: null });
    });

    it("returns Free when there are no subscriptions", async () => {
      const { getStateExternal, gateway } = fakeClient();
      getStateExternal.mockResolvedValue({ active_subscriptions: [] });
      await expect(gateway.getCustomerState("test-user")).resolves.toEqual({ kind: "customer", pro: null });
    });

    it("chooses the latest period end among active Pro subscriptions, accounting for offsets", async () => {
      const { getStateExternal, gateway } = fakeClient();
      getStateExternal.mockResolvedValue({ active_subscriptions: [
        subscription({ id: "earlier", current_period_end: "2026-11-14T01:00:00+09:00" }),
        subscription({ id: "later", current_period_end: "2026-11-13T20:00:00Z", cancel_at_period_end: true }),
        subscription({ id: "inactive", status: "past_due", current_period_end: "2026-12-13T20:00:00Z" }),
        subscription({ id: "other", product_id: "other", current_period_end: "2026-12-13T20:00:00Z" }),
      ] });
      await expect(gateway.getCustomerState("test-user")).resolves.toEqual({
        kind: "customer", pro: {
          subscriptionId: "later", currentPeriodEnd: "2026-11-13T20:00:00Z", cancelAtPeriodEnd: true,
        },
      });
    });

    it.each([
      { error: { statusCode: 500, message: "private-sdk-message", body: "private-body" }, code: "500" },
      { error: new Error("private-network-message"), code: "network" },
      { error: new SyntaxError("private-invalid-json"), code: "unexpected_response" },
      { error: { statusCode: "private-value" }, code: "network" },
    ])("sanitizes failures as get_state/$code", async ({ error, code }) => {
      const { getStateExternal, gateway } = fakeClient();
      getStateExternal.mockRejectedValue(error);
      const result = gateway.getCustomerState("test-user");
      await expect(result).rejects.toBeInstanceOf(PolarGatewayError);
      await expect(result).rejects.toMatchObject({ operation: "get_state", code, message: `polar:get_state:${code}` });
      await expect(result).rejects.not.toHaveProperty("cause");
    });

    it.each([
      null, {}, { active_subscriptions: null }, { active_subscriptions: [null] },
      { active_subscriptions: [subscription({ id: "" })] },
      { active_subscriptions: [subscription({ current_period_end: "invalid-date" })] },
      { active_subscriptions: [subscription({ cancel_at_period_end: "true" })] },
    ])("rejects malformed customer responses: %#", async (response) => {
      const { getStateExternal, gateway } = fakeClient();
      getStateExternal.mockResolvedValue(response);
      await expect(gateway.getCustomerState("test-user")).rejects.toMatchObject({
        operation: "get_state", code: "unexpected_response", message: "polar:get_state:unexpected_response",
      });
    });
  });

  describe("createCheckoutUrl", () => {
    it("sends the product, session user, IP, return URLs and source, and returns the URL", async () => {
      const { createCheckout, gateway } = fakeClient();
      createCheckout.mockResolvedValue({ url: "https://polar.test/checkout/test-user" });
      await expect(gateway.createCheckoutUrl(checkoutInput)).resolves.toBe("https://polar.test/checkout/test-user");
      expect(createCheckout).toHaveBeenCalledExactlyOnceWith({
        products: [proProductId], external_customer_id: "test-user", customer_ip_address: "203.0.113.10",
        success_url: checkoutInput.successUrl, return_url: checkoutInput.returnUrl, metadata: { source: "teaser" },
      });
    });

    it("omits the IP field when no IP is available", async () => {
      const { createCheckout, gateway } = fakeClient();
      createCheckout.mockResolvedValue({ url: "https://polar.test/checkout/test-user" });
      await gateway.createCheckoutUrl({ ...checkoutInput, customerIp: null });
      expect(createCheckout.mock.calls[0][0]).not.toHaveProperty("customer_ip_address");
    });

    it.each([404, 422, 500])("sanitizes HTTP %i instead of swallowing it", async (statusCode) => {
      const { createCheckout, gateway } = fakeClient();
      createCheckout.mockRejectedValue({ statusCode, message: "private-checkout-message" });
      await expect(gateway.createCheckoutUrl(checkoutInput)).rejects.toMatchObject({
        operation: "checkout", code: String(statusCode), message: `polar:checkout:${statusCode}`,
      });
    });

    it("sanitizes a network error", async () => {
      const { createCheckout, gateway } = fakeClient();
      createCheckout.mockRejectedValue(new Error("private-network-message"));
      await expect(gateway.createCheckoutUrl(checkoutInput)).rejects.toThrowError(/^polar:checkout:network$/);
    });

    it.each([null, {}, { url: "" }, { url: "invalid-url" }])("rejects malformed checkout responses: %#", async (response) => {
      const { createCheckout, gateway } = fakeClient();
      createCheckout.mockResolvedValue(response);
      await expect(gateway.createCheckoutUrl(checkoutInput)).rejects.toThrowError(/^polar:checkout:unexpected_response$/);
    });
  });

  describe("createPortalUrl", () => {
    const input = { userId: "test-user", returnUrl: "https://assetomy.test/settings" };

    it("returns the portal URL and sends the external user and return URL", async () => {
      const { createSession, gateway } = fakeClient();
      createSession.mockResolvedValue({ customer_portal_url: "https://polar.test/portal/test-user" });
      await expect(gateway.createPortalUrl(input)).resolves.toBe("https://polar.test/portal/test-user");
      expect(createSession).toHaveBeenCalledExactlyOnceWith({ external_customer_id: input.userId, return_url: input.returnUrl });
    });

    it.each([
      new errors.ResourceNotFound(404, { error: "ResourceNotFound", detail: "private-sdk-detail" }),
      { statusCode: 404, message: "private-sdk-message" },
    ])("returns null for a missing customer: %#", async (error) => {
      const { createSession, gateway } = fakeClient();
      createSession.mockRejectedValue(error);
      await expect(gateway.createPortalUrl(input)).resolves.toBeNull();
    });

    it.each([
      { error: { statusCode: 500, message: "private-sdk-message" }, code: "500" },
      { error: new Error("private-network-message"), code: "network" },
    ])("sanitizes portal/$code failures", async ({ error, code }) => {
      const { createSession, gateway } = fakeClient();
      createSession.mockRejectedValue(error);
      const result = gateway.createPortalUrl(input);
      await expect(result).rejects.toBeInstanceOf(PolarGatewayError);
      await expect(result).rejects.toMatchObject({ operation: "portal", code, message: `polar:portal:${code}` });
    });

    it.each([null, {}, { customer_portal_url: "" }, { customer_portal_url: "invalid-url" }])(
      "rejects malformed portal responses: %#", async (response) => {
        const { createSession, gateway } = fakeClient();
        createSession.mockResolvedValue(response);
        await expect(gateway.createPortalUrl(input)).rejects.toThrowError(/^polar:portal:unexpected_response$/);
      },
    );
  });
});
