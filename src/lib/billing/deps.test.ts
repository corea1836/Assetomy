import { afterEach, describe, expect, it, vi } from "vitest";
import { getPolarEnv } from "@/lib/env";
import { getMode } from "@/lib/mode";
import { getSiteOrigin } from "@/lib/origin";
import { saveSubscription } from "@/lib/store/subscriptions";
import { recordMetric } from "@/lib/store/metrics";
import { getPolarGateway } from "@/services/polar";
import { defaultBillingDeps } from "./deps";

vi.mock("@/lib/mode", () => ({ getMode: vi.fn(() => "mock") }));
vi.mock("@/lib/env", () => ({ getPolarEnv: vi.fn() }));
vi.mock("@/lib/origin", () => ({ getSiteOrigin: vi.fn(() => "https://assetomy.test") }));
vi.mock("@/lib/store/subscriptions", () => ({ saveSubscription: vi.fn() }));
vi.mock("@/lib/store/metrics", () => ({ recordMetric: vi.fn() }));
vi.mock("@/services/polar", () => ({ getPolarGateway: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe("defaultBillingDeps", () => {
  it.each(["mock", "live"] as const)("uses existing providers without constructing a gateway in %s", (mode) => {
    vi.mocked(getMode).mockReturnValue(mode);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T06:00:00Z"));
    const deps = defaultBillingDeps();
    expect(deps.mode).toBe(mode);
    expect(deps.origin).toBe("https://assetomy.test");
    expect(getMode).toHaveBeenCalledExactlyOnceWith();
    expect(getSiteOrigin).toHaveBeenCalledExactlyOnceWith();
    expect(deps.gateway).toBe(getPolarGateway);
    expect(deps.saveSubscription).toBe(saveSubscription);
    expect(deps.recordMetric).toBe(recordMetric);
    expect(recordMetric).not.toHaveBeenCalled();
    expect(getPolarEnv).not.toHaveBeenCalled();
    expect(getPolarGateway).not.toHaveBeenCalled();
    expect(saveSubscription).not.toHaveBeenCalled();
    expect(deps.now().toISOString()).toBe("2026-10-13T06:00:00.000Z");
    vi.setSystemTime(new Date("2026-10-13T06:00:01Z"));
    expect(deps.now().toISOString()).toBe("2026-10-13T06:00:01.000Z");
  });

  it("does not read Polar env when checking mock billing", () => {
    vi.mocked(getMode).mockReturnValue("mock");
    vi.mocked(getPolarEnv).mockImplementation(() => { throw new Error("POLAR_ENV"); });
    expect(defaultBillingDeps().isProductionBilling()).toBe(false);
    expect(getPolarEnv).not.toHaveBeenCalled();
  });

  it.each(["sandbox", "production"] as const)("checks Polar %s lazily on each invocation", (server) => {
    vi.mocked(getMode).mockReturnValue("live");
    vi.mocked(getPolarEnv).mockReturnValue({ server, accessToken: "test-token", proProductId: "test-pro" });
    const deps = defaultBillingDeps();
    expect(getPolarEnv).not.toHaveBeenCalled();
    expect(deps.isProductionBilling()).toBe(server === "production");
    expect(getPolarEnv).toHaveBeenCalledExactlyOnceWith();
    vi.mocked(getMode).mockReturnValue("mock");
    expect(deps.isProductionBilling()).toBe(false);
    expect(getPolarEnv).toHaveBeenCalledTimes(1);
  });
});
