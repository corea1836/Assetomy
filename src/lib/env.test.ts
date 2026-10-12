import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDeploymentEnv, getFileEncryptionKey, getSupabaseEnv } from "./env";

const envNames = [
  "VERCEL_ENV",
  "VERCEL_URL",
  "NEXT_PUBLIC_SITE_URL",
  "APP_MODE",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "FILE_ENCRYPTION_KEY",
] as const;

beforeEach(() => {
  for (const name of envNames) vi.stubEnv(name, undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe("getFileEncryptionKey", () => {
  it("decodes a canonical 32-byte base64 key", () => {
    const key = randomBytes(32);
    vi.stubEnv("FILE_ENCRYPTION_KEY", key.toString("base64"));

    const decoded = getFileEncryptionKey();
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(decoded)).toEqual(key);
  });

  it.each([
    { name: "unset", value: undefined },
    { name: "empty", value: "" },
    { name: "invalid base64", value: "not-base64!" },
    { name: "16 bytes", value: randomBytes(16).toString("base64") },
    { name: "33 bytes", value: randomBytes(33).toString("base64") },
    { name: "missing padding", value: randomBytes(32).toString("base64").slice(0, -1) },
    { name: "extra padding", value: `${randomBytes(32).toString("base64")}=` },
    { name: "whitespace", value: ` ${randomBytes(32).toString("base64")}` },
  ])("reports only the variable name for $name", ({ value }) => {
    vi.stubEnv("FILE_ENCRYPTION_KEY", value);

    expect(() => getFileEncryptionKey()).toThrowError(/^FILE_ENCRYPTION_KEY$/);
    if (value) {
      expect(() => getFileEncryptionKey()).not.toThrowError(value);
    }
  });

  it("reads the current key on every call", () => {
    const first = randomBytes(32);
    const second = randomBytes(32);

    vi.stubEnv("FILE_ENCRYPTION_KEY", first.toString("base64"));
    expect(Buffer.from(getFileEncryptionKey())).toEqual(first);
    vi.stubEnv("FILE_ENCRYPTION_KEY", second.toString("base64"));
    expect(Buffer.from(getFileEncryptionKey())).toEqual(second);
  });

  it("can be freshly imported without an encryption key", async () => {
    vi.resetModules();
    await expect(import("./env")).resolves.toHaveProperty(
      "getFileEncryptionKey",
      expect.any(Function),
    );
  });
});

describe("getSupabaseEnv", () => {
  it.each(["https://example.supabase.co", "http://localhost:54321"])(
    "accepts an HTTP(S) URL: %s",
    (url) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");

      expect(getSupabaseEnv()).toEqual({
        url,
        publishableKey: "sb_publishable_test",
      });
    },
  );

  it.each([undefined, ""])(
    "reports both variable names for absent settings: %j",
    (value) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", value);
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", value);

      expect(() => getSupabaseEnv()).toThrowError(
        /^NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY$/,
      );
    },
  );

  it.each(["not-a-url", "ftp://x"])("rejects an invalid URL: %s", (url) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");

    expect(() => getSupabaseEnv()).toThrowError(/^NEXT_PUBLIC_SUPABASE_URL$/);
    expect(() => getSupabaseEnv()).not.toThrowError(/sb_publishable_test/);
  });

  it.each([undefined, ""])("rejects an absent key: %j", (key) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);

    expect(() => getSupabaseEnv()).toThrowError(
      /^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY$/,
    );
  });

  it("reads new settings on every call", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    expect(getSupabaseEnv()).toEqual({
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_test",
    });

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://other.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_other");
    expect(getSupabaseEnv()).toEqual({
      url: "https://other.supabase.co",
      publishableKey: "sb_publishable_other",
    });
  });

  it("can be freshly imported without Supabase settings", async () => {
    vi.resetModules();
    await expect(import("./env")).resolves.toHaveProperty(
      "getSupabaseEnv",
      expect.any(Function),
    );
  });
});

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
