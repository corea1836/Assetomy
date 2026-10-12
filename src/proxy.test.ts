import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));

const getClaims = vi.fn();

beforeEach(() => {
  getClaims.mockReset().mockResolvedValue({ data: null, error: null });
  vi.mocked(createServerClient).mockReset().mockReturnValue({
    auth: { getClaims },
  } as unknown as SupabaseClient);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

afterEach(() => vi.unstubAllEnvs());

function getCookieMethods() {
  return vi.mocked(createServerClient).mock.calls[0][2].cookies;
}

describe("proxy", () => {
  it("passes a request without cookies through and checks claims once", async () => {
    const response = await proxy(new NextRequest("https://assetomy.example/dashboard"));

    expect(createServerClient).toHaveBeenCalledExactlyOnceWith(
      "https://example.supabase.co",
      "sb_publishable_test",
      { cookies: { getAll: expect.any(Function), setAll: expect.any(Function) } },
    );
    expect(getCookieMethods().getAll()).toEqual([]);
    expect(getClaims).toHaveBeenCalledExactlyOnceWith();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.has("location")).toBe(false);
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it("reads incoming cookies and passes refreshed cookies to the request and response", async () => {
    const request = new NextRequest("https://assetomy.example/dashboard", {
      headers: { cookie: "sb-test-auth-token=old" },
    });
    getClaims.mockImplementation(async () => {
      expect(getCookieMethods().getAll()).toEqual([
        { name: "sb-test-auth-token", value: "old" },
      ]);
      await getCookieMethods().setAll!([
        { name: "sb-test-auth-token", value: "refreshed", options: { path: "/" } },
      ], {});
      return { data: { claims: { sub: "test-user" } }, error: null };
    });

    const response = await proxy(request);

    expect(request.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      "sb-test-auth-token=refreshed",
    );
    expect(response.headers.get("set-cookie")).toContain("sb-test-auth-token=refreshed");
    expect(response.cookies.get("sb-test-auth-token")?.path).toBe("/");
    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
    expect(getClaims).toHaveBeenCalledExactlyOnceWith();
  });

  it("copies cookie chunks and Supabase cache headers onto the response", async () => {
    const cacheHeaders = {
      "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
      Expires: "0",
      Pragma: "no-cache",
    };
    getClaims.mockImplementation(async () => {
      await getCookieMethods().setAll!([
        { name: "sb-test-auth-token.0", value: "first", options: { path: "/" } },
        { name: "sb-test-auth-token.1", value: "second", options: { path: "/", httpOnly: true } },
      ], cacheHeaders);
      return { data: null, error: null };
    });

    const request = new NextRequest("https://assetomy.example/dashboard");
    const response = await proxy(request);

    expect(request.cookies.getAll()).toEqual([
      { name: "sb-test-auth-token.0", value: "first" },
      { name: "sb-test-auth-token.1", value: "second" },
    ]);
    expect(response.cookies.get("sb-test-auth-token.0")?.value).toBe("first");
    expect(response.cookies.get("sb-test-auth-token.1")?.httpOnly).toBe(true);
    for (const [name, value] of Object.entries(cacheHeaders)) {
      expect(response.headers.get(name)).toBe(value);
    }
    expect(getClaims).toHaveBeenCalledExactlyOnceWith();
  });
});

describe("proxy matcher", () => {
  const matches = (path: string) => config.matcher.some(
    (pattern) => new RegExp(`^${pattern}$`).test(path),
  );

  it.each([
    "/_next/static/x.js",
    "/_next/image",
    "/favicon.ico",
    "/logo.svg",
    "/image.png",
    "/image.jpg",
    "/image.jpeg",
    "/image.gif",
    "/image.webp",
    "/icon.ico",
  ])("excludes static assets: %s", (path) => {
    expect(matches(path)).toBe(false);
  });

  it.each(["/", "/dashboard", "/demo", "/auth/callback", "/api/uploads"])(
    "includes page and handler paths: %s",
    (path) => {
      expect(matches(path)).toBe(true);
    },
  );
});
