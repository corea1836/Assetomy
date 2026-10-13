import { createPolar } from "@polar-sh/sdk/2026-10";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPolarEnv } from "@/lib/env";
import { getMode } from "@/lib/mode";
import { getPolarGateway } from "./index";

const { client } = vi.hoisted(() => ({ client: {
  customers: { getStateExternal: vi.fn() }, checkouts: { create: vi.fn() },
  customerSessions: { create: vi.fn() },
} }));
vi.mock("@polar-sh/sdk/2026-10", () => ({ createPolar: vi.fn(() => client), errors: { ResourceNotFound: class extends Error {} } }));
vi.mock("@/lib/env", () => ({ getPolarEnv: vi.fn() }));
vi.mock("@/lib/mode", () => ({ getMode: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createPolar).mockReturnValue(client as unknown as ReturnType<typeof createPolar>);
});

describe("getPolarGateway", () => {
  it("throws in mock mode without reading Polar env or creating a client", () => {
    vi.mocked(getMode).mockReturnValue("mock");
    expect(() => getPolarGateway()).toThrowError(/^polar:mock_mode$/);
    expect(getPolarEnv).not.toHaveBeenCalled();
    expect(createPolar).not.toHaveBeenCalled();
  });

  it.each(["sandbox", "production"] as const)("creates a live %s client with a ten-second timeout", async (server) => {
    vi.mocked(getMode).mockReturnValue("live");
    vi.mocked(getPolarEnv).mockReturnValue({ accessToken: "test-token", server, proProductId: "pro-product" });
    client.checkouts.create.mockResolvedValue({ url: "https://polar.test/checkout/test-user" });
    const gateway = getPolarGateway();
    expect(createPolar).toHaveBeenCalledExactlyOnceWith({ accessToken: "test-token", environment: server, timeout: 10 });
    expect(client.checkouts.create).not.toHaveBeenCalled();
    await gateway.createCheckoutUrl({
      userId: "test-user", customerIp: null, successUrl: "https://assetomy.test/dashboard?checkout=success",
      returnUrl: "https://assetomy.test/dashboard", source: "summary",
    });
    expect(client.checkouts.create.mock.calls[0][0].products).toEqual(["pro-product"]);
  });

  it("propagates the sanitized env error before creating a client", () => {
    vi.mocked(getMode).mockReturnValue("live");
    vi.mocked(getPolarEnv).mockImplementation(() => { throw new Error("POLAR_ACCESS_TOKEN"); });
    expect(() => getPolarGateway()).toThrowError(/^POLAR_ACCESS_TOKEN$/);
    expect(createPolar).not.toHaveBeenCalled();
  });

  it("does not initialize Polar when freshly imported", async () => {
    vi.resetModules();
    await expect(import("./index")).resolves.toHaveProperty("getPolarGateway", expect.any(Function));
    expect(getPolarEnv).not.toHaveBeenCalled();
    expect(createPolar).not.toHaveBeenCalled();
  });
});
