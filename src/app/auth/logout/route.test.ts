import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const signOut = vi.fn();

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  signOut.mockReset().mockResolvedValue({ error: null });
  vi.mocked(createSupabaseServerClient).mockReset().mockResolvedValue({
    auth: { signOut },
  } as unknown as SupabaseClient);
});

afterEach(() => vi.unstubAllEnvs());

function logoutRequest({
  origin = "http://localhost:3000",
  contentType = "application/x-www-form-urlencoded",
  url = "http://localhost:3000/auth/logout",
}: {
  origin?: string | null;
  contentType?: string | null;
  url?: string;
} = {}): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  if (contentType !== null) headers.set("content-type", contentType);

  const request = new Request(url, { method: "POST", headers, body: "" });
  if (contentType === null) request.headers.delete("content-type");
  return request;
}

describe("POST /auth/logout", () => {
  it.each([
    null,
    "null",
    "https://evil.example",
    "http://localhost:3100",
    "http://localhost:3000/",
  ])("rejects an unapproved Origin: %s", async (origin) => {
    const response = await POST(logoutRequest({ origin }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "FORBIDDEN" } });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it.each(["application/json", "multipart/form-data", null])(
    "rejects a non-form content type: %s",
    async (contentType) => {
      const response = await POST(logoutRequest({ contentType }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST" } });
      expect(createSupabaseServerClient).not.toHaveBeenCalled();
      expect(signOut).not.toHaveBeenCalled();
    },
  );

  it("checks Origin before the content type", async () => {
    const response = await POST(logoutRequest({
      origin: "https://evil.example",
      contentType: "application/json",
    }));

    expect(response.status).toBe(403);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("signs out only the local session and redirects to the landing page", async () => {
    const response = await POST(logoutRequest());

    expect(createSupabaseServerClient).toHaveBeenCalledExactlyOnceWith();
    expect(signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("accepts case-insensitive form media types with a charset", async () => {
    const response = await POST(logoutRequest({
      contentType: "Application/X-Www-Form-Urlencoded; charset=UTF-8",
    }));

    expect(response.status).toBe(303);
    expect(signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });

  it("returns to the dashboard on sign-out error without exposing its contents", async () => {
    signOut.mockResolvedValue({ error: new Error("PRIVATE_SIGNOUT_ERROR") });

    const response = await POST(logoutRequest());

    expect(signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/dashboard");
    expect(await response.text()).not.toContain("PRIVATE_SIGNOUT_ERROR");
  });

  it("uses the configured site Origin for the landing redirect", async () => {
    const response = await POST(logoutRequest({ url: "http://evil.example/auth/logout" }));

    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("uses the configured site Origin for the failure redirect", async () => {
    signOut.mockResolvedValue({ error: new Error("SIGNOUT_FAILED") });

    const response = await POST(logoutRequest({ url: "http://evil.example/auth/logout" }));

    expect(response.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });
});
