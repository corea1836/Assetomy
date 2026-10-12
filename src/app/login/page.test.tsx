import { render, screen } from "@testing-library/react";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionUser } from "@/lib/auth";
import { LOGIN_ERROR_MESSAGES } from "@/lib/errors/messages";
import LoginPage, { metadata } from "./page";

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getSessionUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

beforeEach(() => {
  vi.mocked(getSessionUser).mockReset().mockResolvedValue(null);
  vi.mocked(redirect).mockReset().mockImplementation((path) => {
    throw new Error(`REDIRECT:${path}`);
  });
});

async function renderLogin(params: {
  next?: string | string[];
  error?: string | string[];
} = {}) {
  return render(await LoginPage({ searchParams: Promise.resolve(params) }));
}

describe("login page", () => {
  it("explains sign-in and posts the default return path through the Google button", async () => {
    await renderLogin();

    expect(metadata.title).toBe("로그인 · assetomy");
    expect(screen.getByRole("heading", { level: 1, name: "구글 계정으로 시작해요" }))
      .toBeInTheDocument();
    expect(screen.getByText("카드번호·계좌·카드사 비밀번호는 받지 않아요"))
      .toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Google로 계속하기" });
    const form = button.closest("form");
    expect(form).toHaveAttribute("action", "/auth/login");
    expect(form).toHaveAttribute("method", "post");
    expect(form?.querySelector('input[name="next"]')).toHaveAttribute("type", "hidden");
    expect(form?.querySelector('input[name="next"]')).toHaveValue("/dashboard");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getSessionUser).toHaveBeenCalledExactlyOnceWith();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("shows only the home wordmark in the header and centers the sign-in content", async () => {
    await renderLogin();

    const wordmark = screen.getByRole("link", { name: "assetomy" });
    expect(wordmark).toHaveAttribute("href", "/");
    expect(wordmark).toHaveClass(
      "rounded-lg", "focus-visible:outline-2",
      "focus-visible:outline-offset-2", "focus-visible:outline-primary",
    );
    expect(wordmark.closest("header")?.textContent).toBe("assetomy");
    expect(wordmark.closest("header")?.parentElement).toHaveClass(
      "mx-auto", "max-w-5xl", "px-4", "sm:px-6",
    );
    expect(screen.getByRole("main")).toHaveClass(
      "mx-auto", "max-w-sm", "px-4", "pt-16", "text-center",
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it.each([
    { next: "/dashboard?month=2026-09", expected: "/dashboard?month=2026-09" },
    { next: "//evil.com", expected: "/dashboard" },
    { next: ["/a", "/b"], expected: "/dashboard" },
  ])("sanitizes the hidden return path for $next", async ({ next, expected }) => {
    await renderLogin({ next });

    const form = screen.getByRole("button", { name: "Google로 계속하기" }).closest("form");
    expect(form?.querySelector('input[name="next"]')).toHaveValue(expected);
  });

  it.each(["cancelled", "failed"] as const)(
    "shows the shared %s error with retry guidance before the form",
    async (error) => {
      await renderLogin({ error });

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toBe(LOGIN_ERROR_MESSAGES[error]);
      expect(alert).toHaveTextContent("다시 시도해 주세요");
      expect(alert).toHaveClass("rounded-xl", "bg-red-50", "text-left", "text-sm", "text-danger");
      const form = screen.getByRole("button", { name: "Google로 계속하기" }).closest("form");
      expect(alert.compareDocumentPosition(form as HTMLElement))
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    },
  );

  it.each([{ error: "zzz" }, { error: ["failed", "cancelled"] }])(
    "ignores an unknown or repeated error parameter: $error",
    async ({ error }) => {
      await renderLogin({ error });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it.each([
    { next: "/dashboard?month=2026-09", expected: "/dashboard?month=2026-09" },
    { next: "//evil.com", expected: "/dashboard" },
    { next: ["/a", "/b"], expected: "/dashboard" },
  ])("redirects a signed-in user to the safe return path for $next", async ({ next, expected }) => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: "u1" });

    await expect(LoginPage({ searchParams: Promise.resolve({ next }) }))
      .rejects.toThrowError(`REDIRECT:${expected}`);
    expect(redirect).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it.each([{ error: undefined }, { error: "cancelled" }, { error: "failed" }])(
    "keeps all displayed text calm and free of forbidden terms: $error",
    async ({ error }) => {
      const { container } = await renderLogin({ error });

      for (const phrase of ["!", "명세서", "AI가 분석했어요"]) {
        expect(container).not.toHaveTextContent(phrase);
      }
    },
  );
});
