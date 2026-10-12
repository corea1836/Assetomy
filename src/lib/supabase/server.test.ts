import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "./server";

const { cookieStore, fakeClient } = vi.hoisted(() => ({
  cookieStore: { getAll: vi.fn(), set: vi.fn() },
  fakeClient: { auth: {} },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => fakeClient),
}));

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.getAll.mockReset().mockReturnValue([]);
  cookieStore.set.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

afterEach(() => vi.unstubAllEnvs());

function getCookieMethods() {
  return vi.mocked(createServerClient).mock.calls[0][2].cookies;
}

describe("createSupabaseServerClient", () => {
  it("creates a client with public settings and the current cookie store", async () => {
    expect(await createSupabaseServerClient()).toBe(fakeClient);
    expect(cookies).toHaveBeenCalledExactlyOnceWith();
    expect(createServerClient).toHaveBeenCalledExactlyOnceWith(
      "https://example.supabase.co",
      "sb_publishable_test",
      { cookies: { getAll: expect.any(Function), setAll: expect.any(Function) } },
    );
  });

  it("reads all cookies from the store", async () => {
    const storedCookies = [{ name: "sb-test-auth-token", value: "test-token" }];
    cookieStore.getAll.mockReturnValue(storedCookies);

    await createSupabaseServerClient();

    expect(getCookieMethods().getAll()).toBe(storedCookies);
    expect(cookieStore.getAll).toHaveBeenCalledExactlyOnceWith();
  });

  it("writes every cookie with its options", async () => {
    await createSupabaseServerClient();
    const cookiesToSet = [
      { name: "sb-test-auth-token.0", value: "first", options: { path: "/" } },
      {
        name: "sb-test-auth-token.1",
        value: "second",
        options: { path: "/", httpOnly: true, sameSite: "lax" as const },
      },
    ];

    getCookieMethods().setAll!(cookiesToSet, {});

    expect(cookieStore.set).toHaveBeenCalledTimes(2);
    for (const [index, { name, value, options }] of cookiesToSet.entries()) {
      expect(cookieStore.set).toHaveBeenNthCalledWith(index + 1, name, value, options);
    }
  });

  it("tolerates a cookie write rejected during Server Component rendering", async () => {
    cookieStore.set.mockImplementation(() => {
      throw new Error("COOKIE_WRITE_NOT_ALLOWED");
    });
    await createSupabaseServerClient();

    expect(() => getCookieMethods().setAll!([
      { name: "sb-test-auth-token", value: "refreshed", options: { path: "/" } },
    ], {})).not.toThrow();
    expect(cookieStore.set).toHaveBeenCalledOnce();
  });
});
