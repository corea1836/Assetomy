import { afterEach, describe, expect, it, vi } from "vitest";
import { getMode } from "@/lib/mode";
import { getSiteOrigin } from "@/lib/origin";
import { saveSubscription } from "@/lib/store/subscriptions";
import { getPolarGateway } from "@/services/polar";
import { defaultBillingDeps } from "./deps";

vi.mock("@/lib/mode", () => ({ getMode: vi.fn(() => "mock") }));
vi.mock("@/lib/origin", () => ({ getSiteOrigin: vi.fn(() => "https://assetomy.test") }));
vi.mock("@/lib/store/subscriptions", () => ({ saveSubscription: vi.fn() }));
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
    expect(getPolarGateway).not.toHaveBeenCalled();
    expect(saveSubscription).not.toHaveBeenCalled();
    expect(deps.now().toISOString()).toBe("2026-10-13T06:00:00.000Z");
    vi.setSystemTime(new Date("2026-10-13T06:00:01Z"));
    expect(deps.now().toISOString()).toBe("2026-10-13T06:00:01.000Z");
  });
});
