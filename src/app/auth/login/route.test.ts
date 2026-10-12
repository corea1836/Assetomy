import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const signInWithOAuth = vi.fn();
const oauthUrl = "https://example.supabase.co/auth/v1/authorize?provider=google";

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  signInWithOAuth.mockReset().mockResolvedValue({
    data: { provider: "google", url: oauthUrl },
    error: null,
  });
  vi.mocked(createSupabaseServerClient).mockReset().mockResolvedValue({
    auth: { signInWithOAuth },
  } as unknown as SupabaseClient);
});

afterEach(() => vi.unstubAllEnvs());

function loginRequest({
  origin = "http://localhost:3000",
  contentType = "application/x-www-form-urlencoded",
  next,
  url = "http://localhost:3000/auth/login",
}: {
  origin?: string | null;
  contentType?: string | null;
  next?: string;
  url?: string;
} = {}): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  if (contentType !== null) headers.set("content-type", contentType);
  const body = new URLSearchParams(next === undefined ? {} : { next }).toString();

  const request = new Request(url, { method: "POST", headers, body });
  if (contentType === null) request.headers.delete("content-type");
  return request;
}

describe("POST /auth/login", () => {
  it.each([
    null,
    "null",
    "https://evil.example",
    "http://localhost:3100",
    "http://localhost:3000/",
  ])("rejects an unapproved Origin: %s", async (origin) => {
    const response = await POST(loginRequest({ origin }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "FORBIDDEN" } });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it.each(["application/json", "multipart/form-data", null])(
    "rejects a non-form content type: %s",
    async (contentType) => {
      const response = await POST(loginRequest({ contentType }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST" } });
      expect(createSupabaseServerClient).not.toHaveBeenCalled();
      expect(signInWithOAuth).not.toHaveBeenCalled();
    },
  );

  it("checks Origin before the content type", async () => {
    const response = await POST(loginRequest({
      origin: "https://evil.example",
      contentType: "application/json",
    }));

    expect(response.status).toBe(403);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("starts Google OAuth with an encoded internal return path", async () => {
    const response = await POST(loginRequest({ next: "/dashboard?month=2026-09" }));

    expect(createSupabaseServerClient).toHaveBeenCalledExactlyOnceWith();
    expect(signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
      provider: "google",
      options: {
        redirectTo: "http://localhost:3000/auth/callback?next=%2Fdashboard%3Fmonth%3D2026-09",
      },
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(oauthUrl);
  });

  it("accepts case-insensitive form media types with a charset", async () => {
    const response = await POST(loginRequest({
      contentType: "Application/X-Www-Form-Urlencoded; charset=UTF-8",
    }));

    expect(response.status).toBe(303);
    expect(signInWithOAuth).toHaveBeenCalledOnce();
  });

  it.each([undefined, "", "//evil.com", "/login", "/auth/callback", "/\\evil.com"])(
    "defaults an absent or unsafe return path to the dashboard: %s",
    async (next) => {
      const response = await POST(loginRequest({ next }));

      expect(signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
        provider: "google",
        options: { redirectTo: "http://localhost:3000/auth/callback?next=%2Fdashboard" },
      });
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(oauthUrl);
    },
  );

  it("uses the configured site Origin even when the request host differs", async () => {
    await POST(loginRequest({ url: "http://evil.example/auth/login" }));

    expect(signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
      provider: "google",
      options: { redirectTo: "http://localhost:3000/auth/callback?next=%2Fdashboard" },
    });
  });

  it("redirects an OAuth error to login without exposing its contents", async () => {
    signInWithOAuth.mockResolvedValue({
      data: { url: oauthUrl },
      error: new Error("PRIVATE_OAUTH_ERROR"),
    });

    const response = await POST(loginRequest());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fdashboard&error=failed",
    );
    expect(await response.text()).not.toContain("PRIVATE_OAUTH_ERROR");
  });

  it.each([null, ""])("redirects a missing OAuth URL to login: %s", async (url) => {
    signInWithOAuth.mockResolvedValue({ data: { url }, error: null });

    const response = await POST(loginRequest({ next: "/settings#plan" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fsettings%23plan&error=failed",
    );
  });

  it("uses the configured site Origin for failure redirects", async () => {
    signInWithOAuth.mockResolvedValue({ data: { url: null }, error: null });

    const response = await POST(loginRequest({ url: "http://evil.example/auth/login" }));

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fdashboard&error=failed",
    );
  });
});
