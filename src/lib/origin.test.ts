import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSiteOrigin, isAllowedOrigin } from "./origin";

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("VERCEL_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined);
  vi.stubEnv("APP_MODE", undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe("getSiteOrigin", () => {
  it("normalizes the production URL to its origin", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://assetomy.example/path/");
    expect(getSiteOrigin()).toBe("https://assetomy.example");
  });

  it.each([undefined, "", "http://assetomy.example"])(
    "rejects missing or insecure production site URL: %s",
    (value) => {
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", value);
      expect(() => getSiteOrigin()).toThrowError(/^NEXT_PUBLIC_SITE_URL$/);
    },
  );

  it("uses VERCEL_URL for preview even when a site URL is configured", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "x.vercel.app");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://assetomy.example");
    expect(getSiteOrigin()).toBe("https://x.vercel.app");
  });

  it.each([undefined, ""])("requires a preview host: %s", (value) => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", value);
    expect(() => getSiteOrigin()).toThrowError(/^VERCEL_URL$/);
  });

  it.each([undefined, "development"])(
    "defaults to localhost for VERCEL_ENV=%s",
    (value) => {
      vi.stubEnv("VERCEL_ENV", value);
      expect(getSiteOrigin()).toBe("http://localhost:3000");
    },
  );

  it.each([undefined, "development"])(
    "uses the configured local site URL for VERCEL_ENV=%s",
    (value) => {
      vi.stubEnv("VERCEL_ENV", value);
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3001/path/?a=1#b");
      expect(getSiteOrigin()).toBe("http://localhost:3001");
    },
  );

  it("uses the local default when the site URL is empty", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(getSiteOrigin()).toBe("http://localhost:3000");
  });

  it("can be freshly imported without environment variables", async () => {
    vi.resetModules();
    await expect(import("./origin")).resolves.toMatchObject({
      getSiteOrigin: expect.any(Function),
      isAllowedOrigin: expect.any(Function),
    });
  });
});

describe("isAllowedOrigin", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://assetomy.example/path/");
  });

  it.each([
    ["https://assetomy.example", true],
    ["https://assetomy.example/", false],
    ["http://assetomy.example", false],
    ["https://assetomy.example:8443", false],
    ["https://sub.assetomy.example", false],
    ["https://assetomy.example.evil.com", false],
    ["http://localhost:3000", false],
    [null, false],
    ["null", false],
  ] as const)("checks exact origin equality for %s", (origin, expected) => {
    expect(isAllowedOrigin(origin)).toBe(expected);
  });

  it("checks preview against its own origin", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "x.vercel.app");
    expect(isAllowedOrigin("https://x.vercel.app")).toBe(true);
    expect(isAllowedOrigin("https://assetomy.example")).toBe(false);
  });

  it("checks exact port equality locally", () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3001");
    expect(isAllowedOrigin("http://localhost:3001")).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000")).toBe(false);
  });

  it("never allows opaque origins", () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "mailto:hello@assetomy.example");
    expect(isAllowedOrigin(null)).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
  });
});
