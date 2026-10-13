import { describe, expect, it } from "vitest";
import { createFakePolarGateway } from "./fake-gateway";
import { PolarGatewayError, type PolarCustomerState } from "./types";

const customer: PolarCustomerState = { kind: "customer", pro: {
  subscriptionId: "test-subscription", currentPeriodEnd: "2026-11-13T00:00:00Z", cancelAtPeriodEnd: false,
} };
const checkoutInput = {
  userId: "test-user", customerIp: null, successUrl: "https://assetomy.test/dashboard?checkout=success",
  returnUrl: "https://assetomy.test/dashboard", source: "pricing" as const,
};
const portalInput = { userId: "test-user", returnUrl: "https://assetomy.test/settings" };

describe("createFakePolarGateway", () => {
  it("defaults to no_customer and returns no portal", async () => {
    const fake = createFakePolarGateway();
    await expect(fake.getCustomerState("test-user")).resolves.toEqual({ kind: "no_customer" });
    await expect(fake.createPortalUrl(portalInput)).resolves.toBeNull();
  });

  it("supports initial state and setState", async () => {
    const fake = createFakePolarGateway({ "test-user": customer });
    await expect(fake.getCustomerState("test-user")).resolves.toEqual(customer);
    fake.setState("test-user", { kind: "customer", pro: null });
    await expect(fake.getCustomerState("test-user")).resolves.toEqual({ kind: "customer", pro: null });
    fake.setState("other-user", customer);
    await expect(fake.getCustomerState("other-user")).resolves.toEqual(customer);
  });

  it("returns deterministic URLs without changing subscription state", async () => {
    const fake = createFakePolarGateway({ "test-user": customer });
    await expect(fake.createCheckoutUrl(checkoutInput)).resolves.toBe("https://polar.test/checkout/test-user");
    await expect(fake.createPortalUrl(portalInput)).resolves.toBe("https://polar.test/portal/test-user");
    await expect(fake.getCustomerState("test-user")).resolves.toEqual(customer);
  });

  it("creates a checkout URL for a missing customer", async () => {
    const fake = createFakePolarGateway();
    await expect(fake.createCheckoutUrl(checkoutInput)).resolves.toBe("https://polar.test/checkout/test-user");
    await expect(fake.getCustomerState("test-user")).resolves.toEqual({ kind: "no_customer" });
  });

  it.each([
    { method: "getCustomerState", operation: "get_state", input: "test-user" },
    { method: "createCheckoutUrl", operation: "checkout", input: checkoutInput },
    { method: "createPortalUrl", operation: "portal", input: portalInput },
  ] as const)("failNext fails only one $method call and records both calls", async ({ method, operation, input }) => {
    const fake = createFakePolarGateway({ "test-user": customer });
    const invoke = () => {
      if (method === "getCustomerState") return fake.getCustomerState("test-user");
      if (method === "createCheckoutUrl") return fake.createCheckoutUrl(checkoutInput);
      return fake.createPortalUrl(portalInput);
    };
    fake.failNext(method);
    const failed = invoke();
    await expect(failed).rejects.toBeInstanceOf(PolarGatewayError);
    await expect(failed).rejects.toMatchObject({ operation, code: "network", message: `polar:${operation}:network` });
    await expect(invoke()).resolves.toBeDefined();
    expect(fake.calls).toEqual([{ method, input }, { method, input }]);
  });

  it("keeps failures scoped to their method", async () => {
    const fake = createFakePolarGateway({ "test-user": customer });
    fake.failNext("createCheckoutUrl");
    await expect(fake.getCustomerState("test-user")).resolves.toEqual(customer);
    await expect(fake.createPortalUrl(portalInput)).resolves.toBe("https://polar.test/portal/test-user");
    await expect(fake.createCheckoutUrl(checkoutInput)).rejects.toThrowError(/^polar:checkout:network$/);
  });

  it("records method calls in order", async () => {
    const fake = createFakePolarGateway({ "test-user": customer });
    await fake.getCustomerState("test-user");
    await fake.createCheckoutUrl(checkoutInput);
    await fake.createPortalUrl(portalInput);
    expect(fake.calls).toEqual([
      { method: "getCustomerState", input: "test-user" },
      { method: "createCheckoutUrl", input: checkoutInput },
      { method: "createPortalUrl", input: portalInput },
    ]);
  });
});
