import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMode } from "./mode";

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("VERCEL_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined);
  vi.stubEnv("APP_MODE", undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe("getMode", () => {
  it.each([
    ["production", "mock", "live"],
    ["production", "live", "live"],
    ["production", undefined, "live"],
    ["preview", "live", "mock"],
    ["preview", "mock", "mock"],
    ["preview", undefined, "mock"],
    [undefined, undefined, "mock"],
    [undefined, "live", "live"],
    [undefined, "mock", "mock"],
    ["development", "live", "live"],
    ["development", "mock", "mock"],
    ["development", undefined, "mock"],
  ] as const)(
    "uses %s with APP_MODE=%s to return %s",
    (vercelEnv, appMode, expected) => {
      vi.stubEnv("VERCEL_ENV", vercelEnv);
      vi.stubEnv("APP_MODE", appMode);
      expect(getMode()).toBe(expected);
    },
  );

  it("treats empty VERCEL_ENV and APP_MODE as local defaults", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("APP_MODE", "");
    expect(getMode()).toBe("mock");
  });

  it("uses APP_MODE when NODE_ENV is production locally", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_MODE", "live");
    expect(getMode()).toBe("live");

    vi.stubEnv("APP_MODE", "mock");
    expect(getMode()).toBe("mock");
  });

  it("reports APP_MODE without exposing an invalid value", () => {
    vi.stubEnv("APP_MODE", "abc");
    expect(() => getMode()).toThrowError(/^APP_MODE$/);
  });

  it("can be freshly imported without environment variables", async () => {
    vi.resetModules();
    await expect(import("./mode")).resolves.toHaveProperty(
      "getMode",
      expect.any(Function),
    );
  });
});
