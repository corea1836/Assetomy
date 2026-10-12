import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUser } from "@/lib/auth";
import DashboardPage, { metadata } from "./page";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));

beforeEach(() => {
  vi.mocked(requireUser).mockReset().mockResolvedValue({ id: "private-user-id" });
});

describe("dashboard page", () => {
  it("checks the session and shows the minimal preparation screen without the user ID", async () => {
    const { container } = render(await DashboardPage());

    expect(requireUser).toHaveBeenCalledExactlyOnceWith("/dashboard");
    expect(metadata.title).toBe("대시보드 · assetomy");
    expect(screen.getByRole("heading", { level: 1, name: "아직 올린 이용내역이 없어요" }))
      .toBeInTheDocument();
    expect(screen.getByText("카드 이용내역 올리기를 준비하고 있어요."))
      .toBeInTheDocument();
    expect(container).not.toHaveTextContent("private-user-id");
    expect(container.firstElementChild).toHaveClass(
      "mx-auto", "max-w-5xl", "px-4", "pb-12", "sm:px-6",
    );
  });

  it("offers the home wordmark and a small secondary logout submit button in the header", async () => {
    render(await DashboardPage());

    const wordmark = screen.getByRole("link", { name: "assetomy" });
    expect(wordmark).toHaveAttribute("href", "/");
    expect(wordmark).toHaveClass("focus-visible:outline-primary");
    const button = screen.getByRole("button", { name: "로그아웃" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveClass("bg-surface-strong", "h-9");
    expect(button.closest("form")).toHaveAttribute("action", "/auth/logout");
    expect(button.closest("form")).toHaveAttribute("method", "post");
    expect(button.closest("header")).toBe(wordmark.closest("header"));
  });

  it("propagates the login redirect before rendering protected content", async () => {
    const redirectError = new Error("REDIRECT:/login?next=%2Fdashboard");
    vi.mocked(requireUser).mockRejectedValue(redirectError);

    await expect(DashboardPage()).rejects.toBe(redirectError);
    expect(requireUser).toHaveBeenCalledExactlyOnceWith("/dashboard");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
