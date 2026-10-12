import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const exchangeCodeForSession = vi.fn();

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
  vi.mocked(createSupabaseServerClient).mockReset().mockResolvedValue({
    auth: { exchangeCodeForSession },
  } as unknown as SupabaseClient);
});

afterEach(() => vi.unstubAllEnvs());

function callbackRequest(query: string): Request {
  return new Request(`http://localhost:3000/auth/callback${query}`);
}

describe("GET /auth/callback", () => {
  it("exchanges the auth code and redirects to the internal return path", async () => {
    const response = await GET(callbackRequest(
      "?code=abc&next=%2Fdashboard%3Fmonth%3D2026-09",
    ));

    expect(createSupabaseServerClient).toHaveBeenCalledExactlyOnceWith();
    expect(exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("abc");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/dashboard?month=2026-09",
    );
  });

  it("uses the configured site Origin instead of the request host", async () => {
    const response = await GET(new Request("http://evil.example/auth/callback?code=abc"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:3000/dashboard");
    expect(exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("abc");
  });

  it("handles access denial without exchanging the code or exposing the description", async () => {
    const response = await GET(callbackRequest(
      "?code=abc&error=access_denied&error_description=PRIVATE_DESCRIPTION",
    ));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fdashboard&error=cancelled",
    );
    expect(await response.text()).not.toContain("PRIVATE_DESCRIPTION");
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it.each(["server_error", "PRIVATE_PROVIDER_ERROR", ""])(
    "handles other provider errors without exchanging the code: %s",
    async (error) => {
      const response = await GET(callbackRequest(`?code=abc&error=${error}`));

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/login?next=%2Fdashboard&error=failed",
      );
      expect(createSupabaseServerClient).not.toHaveBeenCalled();
      expect(exchangeCodeForSession).not.toHaveBeenCalled();
    },
  );

  it.each(["", "?code=", "?next=%2Fdashboard"])(
    "redirects a missing code to login: %s",
    async (query) => {
      const response = await GET(callbackRequest(query));

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/login?next=%2Fdashboard&error=failed",
      );
      expect(createSupabaseServerClient).not.toHaveBeenCalled();
      expect(exchangeCodeForSession).not.toHaveBeenCalled();
    },
  );

  it("redirects an exchange error to login without exposing its contents", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: new Error("PRIVATE_EXCHANGE_ERROR") });

    const response = await GET(callbackRequest("?code=abc&next=%2Fsettings%23plan"));

    expect(exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("abc");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fsettings%23plan&error=failed",
    );
    expect(await response.text()).not.toContain("PRIVATE_EXCHANGE_ERROR");
  });

  it.each(["//evil.com", "/login", "/auth/logout", "/\\evil.com"])(
    "redirects an unsafe return path to the dashboard: %s",
    async (next) => {
      const response = await GET(callbackRequest(`?code=abc&next=${encodeURIComponent(next)}`));

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("http://localhost:3000/dashboard");
    },
  );

  it("preserves an internal return path on provider cancellation", async () => {
    const response = await GET(callbackRequest(
      "?error=access_denied&next=%2Fdashboard%3Fmonth%3D2026-09",
    ));

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fdashboard%3Fmonth%3D2026-09&error=cancelled",
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("uses the configured site Origin for failure redirects", async () => {
    const response = await GET(new Request(
      "http://evil.example/auth/callback?error=server_error&next=%2F%2Fevil.com",
    ));

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fdashboard&error=failed",
    );
  });
});
