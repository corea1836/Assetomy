import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  DEFAULT_NEXT_PATH,
  getSessionUser,
  loginPath,
  requireUser,
  safeNextPath,
} from "./auth";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const getClaims = vi.fn();

beforeEach(() => {
  getClaims.mockReset().mockResolvedValue({ data: null, error: null });
  vi.mocked(createSupabaseServerClient).mockReset().mockResolvedValue({
    auth: { getClaims },
  } as unknown as SupabaseClient);
  vi.mocked(redirect).mockReset().mockImplementation((path) => {
    throw new Error(`REDIRECT:${path}`);
  });
});

describe("safeNextPath", () => {
  it("defaults to the dashboard", () => {
    expect(DEFAULT_NEXT_PATH).toBe("/dashboard");
  });

  it.each([
    "/dashboard",
    "/dashboard?month=2026-09",
    "/settings#x",
    "/",
    "/settings?next=/login#x",
    "/login-help",
  ])("preserves an allowed internal path: %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    { value: undefined },
    { value: "" },
    { value: ["/dashboard"] },
    { value: "dashboard" },
    { value: "//evil.com" },
    { value: "/\\evil.com" },
    { value: "https://evil.com" },
    { value: "/dash\nboard" },
    { value: "/login" },
    { value: "/login?next=/x" },
    { value: "/login/x" },
    { value: "/auth/callback" },
    { value: "/auth/login" },
    { value: "/login#x" },
    { value: "/login/" },
    { value: "/auth/" },
    { value: "/dashboard?next=\\evil.com" },
    { value: null },
    { value: 1 },
  ])("defaults for an invalid redirect target: $value", ({ value }) => {
    expect(safeNextPath(value)).toBe("/dashboard");
  });

  it.each(["\u0000", "\u0001", "\t", "\r", "\u001f", "\u007f"])(
    "rejects control characters anywhere in the target: %j",
    (character) => {
      expect(safeNextPath(`/dash${character}board`)).toBe("/dashboard");
      expect(safeNextPath(`/settings?x=${character}`)).toBe("/dashboard");
      expect(safeNextPath(`/settings#${character}`)).toBe("/dashboard");
    },
  );
});

describe("loginPath", () => {
  it("encodes the return path without an error", () => {
    expect(loginPath("/settings#x")).toBe("/login?next=%2Fsettings%23x");
  });

  it("encodes the return query and appends an error", () => {
    expect(loginPath("/dashboard?month=2026-09", "failed")).toBe(
      "/login?next=%2Fdashboard%3Fmonth%3D2026-09&error=failed",
    );
  });
});

describe("getSessionUser", () => {
  it("returns only the verified subject as the user ID", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "test-user", email: "test@example.com" } },
      error: null,
    });

    await expect(getSessionUser()).resolves.toEqual({ id: "test-user" });
    expect(createSupabaseServerClient).toHaveBeenCalledExactlyOnceWith();
    expect(getClaims).toHaveBeenCalledExactlyOnceWith();
  });

  it("returns null on an auth error even when a subject is present", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "test-user" } },
      error: new Error("AUTH_FAILED"),
    });

    await expect(getSessionUser()).resolves.toBeNull();
  });

  it.each([
    { data: null },
    { data: {} },
    { data: { claims: {} } },
    { data: { claims: { sub: null } } },
    { data: { claims: { sub: 123 } } },
    { data: { claims: { sub: ["test-user"] } } },
  ])("returns null without a string subject: $data", async ({ data }) => {
    getClaims.mockResolvedValue({ data, error: null });

    await expect(getSessionUser()).resolves.toBeNull();
  });
});

describe("requireUser", () => {
  it("redirects an unauthenticated user to login with the page path", async () => {
    await expect(requireUser("/dashboard")).rejects.toThrowError(
      "REDIRECT:/login?next=%2Fdashboard",
    );
    expect(redirect).toHaveBeenCalledExactlyOnceWith(
      "/login?next=%2Fdashboard",
    );
  });

  it.each(["//evil.com", "/\\evil.com", "/login", "/auth/callback"])(
    "uses the default return path for an unsafe page path: %s",
    async (path) => {
      await expect(requireUser(path)).rejects.toThrowError(
        "REDIRECT:/login?next=%2Fdashboard",
      );
      expect(redirect).toHaveBeenCalledExactlyOnceWith(
        "/login?next=%2Fdashboard",
      );
    },
  );

  it("preserves a protected page query in the login redirect", async () => {
    await expect(requireUser("/dashboard?month=2026-09")).rejects.toThrowError(
      "REDIRECT:/login?next=%2Fdashboard%3Fmonth%3D2026-09",
    );
    expect(redirect).toHaveBeenCalledExactlyOnceWith(
      "/login?next=%2Fdashboard%3Fmonth%3D2026-09",
    );
  });

  it("returns an authenticated user without redirecting", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "test-user" } },
      error: null,
    });

    await expect(requireUser("/dashboard")).resolves.toEqual({ id: "test-user" });
    expect(getClaims).toHaveBeenCalledExactlyOnceWith();
    expect(redirect).not.toHaveBeenCalled();
  });
});
