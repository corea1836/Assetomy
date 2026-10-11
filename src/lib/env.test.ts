import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDeploymentEnv } from "./env";

const envNames = [
  "VERCEL_ENV",
  "VERCEL_URL",
  "NEXT_PUBLIC_SITE_URL",
  "APP_MODE",
] as const;

beforeEach(() => {
  for (const name of envNames) vi.stubEnv(name, undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe("getDeploymentEnv", () => {
  it("returns undefined for unset variables", () => {
    expect(getDeploymentEnv()).toEqual({
      vercelEnv: undefined,
      vercelUrl: undefined,
      siteUrl: undefined,
      appMode: undefined,
    });
  });

  it("treats empty strings as unset variables", () => {
    for (const name of envNames) vi.stubEnv(name, "");

    expect(getDeploymentEnv()).toEqual({
      vercelEnv: undefined,
      vercelUrl: undefined,
      siteUrl: undefined,
      appMode: undefined,
    });
  });

  it("reads the current environment on every call", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "x.vercel.app");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://assetomy.example/path/");
    vi.stubEnv("APP_MODE", "mock");

    expect(getDeploymentEnv()).toEqual({
      vercelEnv: "preview",
      vercelUrl: "x.vercel.app",
      siteUrl: "https://assetomy.example/path/",
      appMode: "mock",
    });

    vi.stubEnv("APP_MODE", "live");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3001");
    expect(getDeploymentEnv()).toMatchObject({
      appMode: "live",
      siteUrl: "http://localhost:3001",
    });
  });

  it.each(["production", "preview", "development"])(
    "accepts VERCEL_ENV=%s",
    (value) => {
      vi.stubEnv("VERCEL_ENV", value);
      expect(getDeploymentEnv().vercelEnv).toBe(value);
    },
  );

  it.each(["mock", "live"])("accepts APP_MODE=%s", (value) => {
    vi.stubEnv("APP_MODE", value);
    expect(getDeploymentEnv().appMode).toBe(value);
  });

  it.each([
    ["VERCEL_ENV", "invalid-deployment"],
    ["APP_MODE", "abc"],
    ["NEXT_PUBLIC_SITE_URL", "not-a-url"],
  ])("reports only the variable name for invalid %s", (name, value) => {
    vi.stubEnv(name, value);
    expect(() => getDeploymentEnv()).toThrowError(new RegExp(`^${name}$`));
  });

  it.each([
    "https://x.vercel.app",
    "x.vercel.app/path",
    "user@x.vercel.app",
    "x.vercel.app:invalid",
  ])("rejects VERCEL_URL that is not a host: %s", (value) => {
    vi.stubEnv("VERCEL_URL", value);
    expect(() => getDeploymentEnv()).toThrowError(/^VERCEL_URL$/);
  });

  it("can be freshly imported without environment variables", async () => {
    vi.resetModules();
    await expect(import("./env")).resolves.toHaveProperty(
      "getDeploymentEnv",
      expect.any(Function),
    );
  });
});
