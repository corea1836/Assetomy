import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUser } from "@/lib/auth";
import { listCards } from "@/lib/queries/cards";
import { getTransactionCoverage } from "@/lib/queries/transactions";
import { listDoneUploads } from "@/lib/queries/uploads";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UploadHistory } from "@/components/upload/upload-history";
import { UploadPanel } from "@/components/upload/upload-panel";
import type { SupabaseClient } from "@supabase/supabase-js";
import DashboardPage, { metadata } from "./page";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/queries/cards", () => ({ listCards: vi.fn() }));
vi.mock("@/lib/queries/transactions", () => ({ getTransactionCoverage: vi.fn() }));
vi.mock("@/lib/queries/uploads", () => ({ listDoneUploads: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/components/upload/upload-panel", () => ({ UploadPanel: vi.fn(() => <div>업로드 패널</div>) }));
vi.mock("@/components/upload/upload-history", () => ({ UploadHistory: vi.fn(() => <div>올린 파일 목록</div>) }));

const supabase = {} as SupabaseClient;
const cards = [{ id: "card-a", label: "현대 생활비" }];

beforeEach(() => {
  vi.mocked(requireUser).mockReset().mockResolvedValue({ id: "private-user-id" });
  vi.mocked(createSupabaseServerClient).mockReset().mockResolvedValue(supabase);
  vi.mocked(listCards).mockReset().mockResolvedValue(cards);
  vi.mocked(getTransactionCoverage).mockReset().mockResolvedValue({ count: 0, from: null, to: null });
  vi.mocked(listDoneUploads).mockReset().mockResolvedValue([]);
  vi.mocked(UploadPanel).mockClear();
  vi.mocked(UploadHistory).mockClear();
});

describe("dashboard page", () => {
  it("checks the session and shows onboarding and a DTO-only panel without the user ID", async () => {
    const { container } = render(await DashboardPage());

    expect(requireUser).toHaveBeenCalledExactlyOnceWith("/dashboard");
    expect(metadata.title).toBe("대시보드 · assetomy");
    expect(screen.getByRole("heading", { level: 1, name: "카드 이용내역을 올려 주세요" }))
      .toBeInTheDocument();
    expect(screen.getByText("업로드 패널")).toBeInTheDocument();
    expect(listCards).toHaveBeenCalledExactlyOnceWith(supabase, "private-user-id");
    expect(getTransactionCoverage).toHaveBeenCalledExactlyOnceWith(supabase, "private-user-id");
    expect(vi.mocked(UploadPanel).mock.calls[0][0]).toEqual({ cards });
    expect(container).not.toHaveTextContent("private-user-id");
    expect(container.firstElementChild).toHaveClass(
      "mx-auto", "max-w-5xl", "px-4", "pb-12", "sm:px-6",
    );
  });

  it("shows stored coverage and the repeat upload panel with the shared folded guide", async () => {
    vi.mocked(getTransactionCoverage).mockResolvedValue({ count: 26, from: "2026-09-01", to: "2026-10-11" });
    const { container } = render(await DashboardPage());
    expect(screen.getByRole("heading", { level: 1, name: "올린 이용내역" })).toBeInTheDocument();
    expect(screen.getByText("거래 26건 · 반영 기간 9/1~10/11")).toBeInTheDocument();
    expect(screen.getByText("월별 대시보드는 준비하고 있어요")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "새 이용내역 추가" })).toBeInTheDocument();
    expect(screen.getByText("업로드 패널")).toBeInTheDocument();
    expect(container.querySelectorAll("#guide-hyundai")).toHaveLength(1);
    expect(container.querySelector("#guide-hyundai")).not.toHaveAttribute("open");
    expect(vi.mocked(UploadPanel).mock.calls[0][0]).toEqual({ cards });
    expect(screen.queryByRole("heading", { name: "카드 이용내역을 올려 주세요" })).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/총지출|이번 달 요약|Pro로 보기/);
    expect(container).not.toHaveTextContent("private-user-id");
  });

  it("lists done uploads as DTOs with card labels instead of card IDs", async () => {
    vi.mocked(getTransactionCoverage).mockResolvedValue({ count: 80, from: "2026-09-01", to: "2026-10-11" });
    vi.mocked(listDoneUploads).mockResolvedValue([
      { id: "upload-b", cardId: "card-a", fileName: "10월.pdf", inserted: 78, periodFrom: "2026-09-12", periodTo: "2026-10-11" },
      { id: "upload-a", cardId: "card-x", fileName: "9월.pdf", inserted: 2, periodFrom: "2026-09-01", periodTo: "2026-09-30" },
    ]);
    const { container } = render(await DashboardPage());
    expect(listDoneUploads).toHaveBeenCalledExactlyOnceWith(supabase, "private-user-id");
    expect(screen.getByText("올린 파일 목록")).toBeInTheDocument();
    expect(vi.mocked(UploadHistory).mock.calls[0][0]).toEqual({ uploads: [
      { id: "upload-b", fileName: "10월.pdf", cardLabel: "현대 생활비", inserted: 78, periodFrom: "2026-09-12", periodTo: "2026-10-11" },
      { id: "upload-a", fileName: "9월.pdf", cardLabel: null, inserted: 2, periodFrom: "2026-09-01", periodTo: "2026-09-30" },
    ] });
    expect(container).not.toHaveTextContent("private-user-id");
  });

  it("does not show the upload list during onboarding", async () => {
    render(await DashboardPage());
    expect(UploadHistory).not.toHaveBeenCalled();
  });

  it("preserves the panel when a refresh switches between onboarding and stored coverage", async () => {
    const view = render(await DashboardPage());
    const panel = screen.getByText("업로드 패널");
    vi.mocked(getTransactionCoverage).mockResolvedValue({ count: 2, from: "2026-09-01", to: "2026-09-30" });
    view.rerender(await DashboardPage());
    expect(screen.getByText("업로드 패널")).toBe(panel);
    vi.mocked(getTransactionCoverage).mockResolvedValue({ count: 0, from: null, to: null });
    view.rerender(await DashboardPage());
    expect(screen.getByText("업로드 패널")).toBe(panel);
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
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(listCards).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
