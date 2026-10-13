import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PricingUpgrade } from "@/components/billing/pricing-upgrade";
import { DailyChart } from "@/components/dashboard/daily-chart";
import { FindingsList } from "@/components/dashboard/findings-list";
import { MonthSelect } from "@/components/dashboard/month-select";
import { TeaserCard } from "@/components/dashboard/teaser-card";
import { TopMerchants } from "@/components/dashboard/top-merchants";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { TrendLockCard } from "@/components/dashboard/trend-lock-card";
import { buildDashboard } from "@/lib/analytics/dashboard";
import { requireUser } from "@/lib/auth";
import { defaultBillingDeps, type BillingDeps } from "@/lib/billing/deps";
import { getPlanState } from "@/lib/billing/plan";
import { listCards } from "@/lib/queries/cards";
import { getSubscription } from "@/lib/queries/subscriptions";
import { seoulToday } from "@/lib/clock";
import { DEMO_TODAY, DEMO_TRANSACTIONS } from "@/lib/demo/fixture";
import { formatWon } from "@/lib/format";
import { listTransactions } from "@/lib/queries/transactions";
import { listDoneUploads } from "@/lib/queries/uploads";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UploadHistory } from "@/components/upload/upload-history";
import { UploadPanel } from "@/components/upload/upload-panel";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FreeDashboard, ProDashboard } from "@/types/dashboard";
import DashboardPage, { metadata } from "./page";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/billing/deps", () => ({ defaultBillingDeps: vi.fn() }));
vi.mock("@/lib/billing/plan", () => ({ getPlanState: vi.fn() }));
vi.mock("@/lib/queries/subscriptions", () => ({ getSubscription: vi.fn() }));
vi.mock("@/lib/clock", () => ({ seoulToday: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard",
}));
vi.mock("@/lib/queries/cards", () => ({ listCards: vi.fn() }));
vi.mock("@/lib/queries/transactions", () => ({ listTransactions: vi.fn() }));
vi.mock("@/lib/queries/uploads", () => ({ listDoneUploads: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/components/upload/upload-panel", () => ({ UploadPanel: vi.fn(() => <div>업로드 패널</div>) }));
vi.mock("@/components/upload/upload-history", () => ({ UploadHistory: vi.fn(() => <div>올린 파일 목록</div>) }));
vi.mock("@/components/dashboard/daily-chart", () => ({ DailyChart: vi.fn(() => <section><h2>일별 지출</h2></section>) }));
vi.mock("@/components/dashboard/trend-chart", () => ({ TrendChart: vi.fn(() => <section><h2>월별 추세</h2></section>) }));
vi.mock("@/components/dashboard/teaser-card", () => ({ TeaserCard: vi.fn(() => <section><h2>후보 지출 티저</h2></section>) }));
vi.mock("@/components/dashboard/trend-lock-card", () => ({ TrendLockCard: vi.fn(() => <section><h2>추세 잠금 카드</h2></section>) }));
vi.mock("@/components/dashboard/findings-list", () => ({ FindingsList: vi.fn(() => <section><h2>확인할 지출 상세</h2></section>) }));
vi.mock("@/components/dashboard/month-select", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/dashboard/month-select")>();
  return { MonthSelect: vi.fn(original.MonthSelect) };
});
vi.mock("@/components/dashboard/top-merchants", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/dashboard/top-merchants")>();
  return { TopMerchants: vi.fn(original.TopMerchants) };
});
vi.mock("@/components/billing/pricing-upgrade", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/billing/pricing-upgrade")>();
  return { PricingUpgrade: vi.fn(original.PricingUpgrade) };
});

const supabase = {} as SupabaseClient;
const deps = {} as BillingDeps;
const cards = [{ id: "card-a", label: "현대 생활비" }];
const freeDashboard = buildDashboard({ transactions: DEMO_TRANSACTIONS, plan: "free", today: DEMO_TODAY }) as FreeDashboard;
const proDashboard = buildDashboard({ transactions: DEMO_TRANSACTIONS, plan: "pro", today: DEMO_TODAY }) as ProDashboard;

function page(params: Record<string, string | string[] | undefined> = {}) {
  return DashboardPage({ searchParams: Promise.resolve(params) });
}

beforeEach(() => {
  vi.mocked(requireUser).mockReset().mockResolvedValue({ id: "private-user-id" });
  vi.mocked(createSupabaseServerClient).mockReset().mockResolvedValue(supabase);
  vi.mocked(listCards).mockReset().mockResolvedValue(cards);
  vi.mocked(listTransactions).mockReset().mockResolvedValue([]);
  vi.mocked(seoulToday).mockReset().mockReturnValue(DEMO_TODAY);
  vi.mocked(listDoneUploads).mockReset().mockResolvedValue([]);
  vi.mocked(getSubscription).mockReset().mockResolvedValue(null);
  vi.mocked(defaultBillingDeps).mockReset().mockReturnValue(deps);
  vi.mocked(getPlanState).mockReset().mockResolvedValue({ plan: "free" });
  vi.mocked(UploadPanel).mockClear();
  vi.mocked(UploadHistory).mockClear();
  for (const component of [DailyChart, FindingsList, MonthSelect, TeaserCard, TopMerchants, TrendChart, TrendLockCard, PricingUpgrade]) {
    vi.mocked(component).mockClear();
  }
});

describe("dashboard page", () => {
  it("checks the session and shows onboarding and a DTO-only panel without the user ID", async () => {
    const { container } = render(await page());

    expect(requireUser).toHaveBeenCalledExactlyOnceWith("/dashboard");
    expect(metadata.title).toBe("대시보드 · assetomy");
    expect(screen.getByRole("heading", { level: 1, name: "카드 이용내역을 올려 주세요" }))
      .toBeInTheDocument();
    expect(screen.getByText("업로드 패널")).toBeInTheDocument();
    expect(listCards).toHaveBeenCalledExactlyOnceWith(supabase, "private-user-id");
    expect(listTransactions).toHaveBeenCalledExactlyOnceWith(supabase, "private-user-id", new Map([["card-a", "현대 생활비"]]));
    expect(seoulToday).toHaveBeenCalledExactlyOnceWith();
    expect(vi.mocked(UploadPanel).mock.calls[0][0]).toEqual({ cards });
    expect(container).not.toHaveTextContent("private-user-id");
    expect(container.firstElementChild).toHaveClass(
      "mx-auto", "max-w-5xl", "px-4", "pb-12", "sm:px-6",
    );
  });

  it("shows the Free monthly dashboard with only teaser totals and a static trend lock", async () => {
    vi.mocked(listTransactions).mockResolvedValue(DEMO_TRANSACTIONS);
    const { container } = render(await page());
    expect(screen.getByRole("heading", { level: 1, name: "2026년 9월 지출" })).toBeInTheDocument();
    expect(screen.getByText("2026년 9월까지 반영됨")).toBeInTheDocument();
    const total = screen.getByRole("heading", { name: "총지출" }).closest("section")!;
    expect(within(total).getByText(formatWon(freeDashboard.snapshot.total))).toBeInTheDocument();
    expect(within(total).getByText("거래 26건 · 반영 기간 9/1~9/30")).toBeInTheDocument();
    expect(total).toHaveTextContent("취소·환불은 카드사 파일의 날짜 기준으로 반영돼요");
    expect(vi.mocked(TeaserCard).mock.calls[0][0]).toEqual({ teaser: freeDashboard.teaser, dataMonthCount: 4 });
    expect(Object.keys(vi.mocked(TeaserCard).mock.calls[0][0]).sort()).toEqual(["dataMonthCount", "teaser"]);
    expect(vi.mocked(TrendLockCard).mock.calls[0]).toEqual([{}, undefined]);
    expect(FindingsList).not.toHaveBeenCalled();
    expect(TrendChart).not.toHaveBeenCalled();
    expect(vi.mocked(TopMerchants).mock.calls[0][0]).toEqual({
      merchants: freeDashboard.snapshot.topMerchants, otherMerchants: freeDashboard.snapshot.otherMerchants, editable: true,
    });
    expect(screen.getByLabelText("예시 별숲 가구실 카테고리")).toBeInTheDocument();
    expect(vi.mocked(MonthSelect).mock.calls[0][0]).toEqual({ months: freeDashboard.months, month: freeDashboard.month });
    expect(vi.mocked(DailyChart).mock.calls[0][0]).toEqual({ daily: freeDashboard.snapshot.daily });
    expect(screen.getByRole("link", { name: "새 이용내역 추가" })).toHaveAttribute("href", "#upload");
    expect(screen.getByRole("link", { name: "새 이용내역 추가" })).toHaveClass("bg-surface-strong", "h-9");
    expect(screen.getByRole("heading", { name: "새 이용내역 추가" })).toBeInTheDocument();
    expect(screen.getByText("업로드 패널")).toBeInTheDocument();
    expect(container.querySelectorAll("#guide-hyundai")).toHaveLength(1);
    expect(container.querySelector("#guide-hyundai")).not.toHaveAttribute("open");
    expect(vi.mocked(UploadPanel).mock.calls[0][0]).toEqual({ cards });
    expect(screen.queryByRole("heading", { name: "카드 이용내역을 올려 주세요" })).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("확인할 지출 상세");
    for (const { id } of DEMO_TRANSACTIONS) expect(container.innerHTML).not.toContain(id);
    expect(container).not.toHaveTextContent(/이번 달 요약|월별 대시보드는 준비하고 있어요|여기부터 Pro 화면이에요|내 카드로 확인해 보세요/);
    expect(container).not.toHaveTextContent("private-user-id");
  });

  it("renders Pro findings and trend DTOs without Free components", async () => {
    vi.mocked(listTransactions).mockResolvedValue(DEMO_TRANSACTIONS);
    vi.mocked(getPlanState).mockResolvedValue({ plan: "pro", periodEnd: null, cancelAtPeriodEnd: false });
    render(await page());
    expect(screen.getByRole("heading", { name: "확인할 지출 상세" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "월별 추세" })).toBeInTheDocument();
    expect(vi.mocked(FindingsList).mock.calls[0][0]).toEqual({ findings: proDashboard.findings, dataMonthCount: 4 });
    expect(vi.mocked(TrendChart).mock.calls[0][0]).toEqual({ trend: proDashboard.trend });
    expect(TeaserCard).not.toHaveBeenCalled();
    expect(TrendLockCard).not.toHaveBeenCalled();
    expect(vi.mocked(TopMerchants).mock.calls[0][0].editable).toBe(true);
  });

  it.each(["free", "pro"] as const)("omits the %s trend with only one month of data", async (plan) => {
    vi.mocked(listTransactions).mockResolvedValue(DEMO_TRANSACTIONS.filter(({ date }) => date.startsWith("2026-09")));
    vi.mocked(getPlanState).mockResolvedValue(plan === "free" ? { plan } : { plan, periodEnd: null, cancelAtPeriodEnd: false });
    render(await page());
    expect(TrendLockCard).not.toHaveBeenCalled();
    expect(TrendChart).not.toHaveBeenCalled();
    const component = plan === "free" ? TeaserCard : FindingsList;
    expect(vi.mocked(component).mock.calls[0][0].dataMonthCount).toBe(1);
  });

  it.each([
    ["2026-07", "2026년 7월 지출", "2026-07"],
    ["2025-01", "2026년 9월 지출", "2026-09"],
    ["2026-13", "2026년 9월 지출", "2026-09"],
    ["abc", "2026년 9월 지출", "2026-09"],
    [["2026-07", "2026-08"], "2026년 9월 지출", "2026-09"],
  ])("resolves month %j using the dashboard DTO", async (month, title, selected) => {
    vi.mocked(listTransactions).mockResolvedValue(DEMO_TRANSACTIONS);
    render(await page({ month }));
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "월 선택" })).toHaveValue(selected);
    expect(screen.getByText("2026년 9월까지 반영됨")).toBeInTheDocument();
    const expected = buildDashboard({ transactions: DEMO_TRANSACTIONS, plan: "free", month: selected, today: DEMO_TODAY })!;
    const total = screen.getByRole("heading", { name: "총지출" }).closest("section")!;
    expect(total).toHaveTextContent(formatWon(expected.snapshot.total));
  });

  it("keeps the guide, panel and uploaded file list together after the dashboard", async () => {
    vi.mocked(listTransactions).mockResolvedValue(DEMO_TRANSACTIONS);
    const { container } = render(await page());
    const upload = container.querySelector<HTMLElement>("section#upload")!;
    expect(within(upload).getByRole("heading", { name: "새 이용내역 추가" })).toBeInTheDocument();
    expect(within(upload).getByText("겹치는 거래는 한 번만 반영돼요")).toBeInTheDocument();
    expect(upload.querySelector("#guide-hyundai")).toBeInTheDocument();
    expect(within(upload).getByText("업로드 패널")).toBeInTheDocument();
    expect(within(upload).getByText("올린 파일 목록")).toBeInTheDocument();
    const headingNames = screen.getAllByRole("heading").map((heading) => heading.textContent);
    const order = ["2026년 9월 지출", "총지출", "카테고리", "가장 많이 쓴 곳", "일별 지출", "후보 지출 티저", "추세 잠금 카드", "새 이용내역 추가"];
    expect(headingNames.filter((name) => order.includes(name!))).toEqual(order);
  });

  it.each([
    [{}, "/dashboard"],
    [{ month: "2026-09" }, "/dashboard?month=2026-09"],
    [{ month: "2026-01" }, "/dashboard?month=2026-01"],
    [{ month: "2026-12" }, "/dashboard?month=2026-12"],
    [{ month: "2026-13" }, "/dashboard"],
    [{ month: "2026-00" }, "/dashboard"],
    [{ month: "abc" }, "/dashboard"],
    [{ month: "2026-9" }, "/dashboard"],
    [{ month: ["2026-09", "2026-08"] }, "/dashboard"],
    [{ upgrade: "pricing", month: "2026-08" }, "/dashboard?month=2026-08&upgrade=pricing"],
    [{ upgrade: "pricing", month: "2026-13" }, "/dashboard?upgrade=pricing"],
    [{ checkout: "success", other: "secret", next: "//other.example", upgrade: "settings" }, "/dashboard"],
  ])("preserves only allowed login return parameters: %j", async (params, nextPath) => {
    await page(params);
    expect(requireUser).toHaveBeenCalledExactlyOnceWith(nextPath);
  });

  it("lists done uploads as DTOs with card labels instead of card IDs", async () => {
    vi.mocked(listTransactions).mockResolvedValue(DEMO_TRANSACTIONS);
    vi.mocked(listDoneUploads).mockResolvedValue([
      { id: "upload-b", cardId: "card-a", fileName: "10월.pdf", inserted: 78, periodFrom: "2026-09-12", periodTo: "2026-10-11" },
      { id: "upload-a", cardId: "card-x", fileName: "9월.pdf", inserted: 2, periodFrom: "2026-09-01", periodTo: "2026-09-30" },
    ]);
    const { container } = render(await page());
    expect(listDoneUploads).toHaveBeenCalledExactlyOnceWith(supabase, "private-user-id");
    expect(screen.getByText("올린 파일 목록")).toBeInTheDocument();
    expect(vi.mocked(UploadHistory).mock.calls[0][0]).toEqual({ uploads: [
      { id: "upload-b", fileName: "10월.pdf", cardLabel: "현대 생활비", inserted: 78, periodFrom: "2026-09-12", periodTo: "2026-10-11" },
      { id: "upload-a", fileName: "9월.pdf", cardLabel: null, inserted: 2, periodFrom: "2026-09-01", periodTo: "2026-09-30" },
    ] });
    expect(container).not.toHaveTextContent("private-user-id");
  });

  it("does not show the upload list during onboarding", async () => {
    render(await page());
    expect(UploadHistory).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: /\d+년 \d+월 지출/ })).not.toBeInTheDocument();
    expect(MonthSelect).not.toHaveBeenCalled();
    expect(TeaserCard).not.toHaveBeenCalled();
    expect(FindingsList).not.toHaveBeenCalled();
  });

  it("preserves the panel when a refresh switches between onboarding and the dashboard", async () => {
    const view = render(await page());
    const panel = screen.getByText("업로드 패널");
    vi.mocked(listTransactions).mockResolvedValue(DEMO_TRANSACTIONS);
    view.rerender(await page());
    expect(screen.getByText("업로드 패널")).toBe(panel);
    vi.mocked(listTransactions).mockResolvedValue([]);
    view.rerender(await page());
    expect(screen.getByText("업로드 패널")).toBe(panel);
  });

  it("offers the home wordmark and a small secondary logout submit button in the header", async () => {
    render(await page());

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

    await expect(page()).rejects.toBe(redirectError);
    expect(requireUser).toHaveBeenCalledExactlyOnceWith("/dashboard");
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(listCards).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("adds a small secondary settings link beside logout", async () => {
    render(await page());
    const link = screen.getByRole("link", { name: "설정" });
    expect(link).toHaveAttribute("href", "/settings");
    expect(link).toHaveClass("bg-surface-strong", "h-9");
    expect(link.closest("header")).toBe(screen.getByRole("button", { name: "로그아웃" }).closest("header"));
  });

  it.each(["free", "pro"] as const)("forces checkout sync and shows a %s notice first in main", async (plan) => {
    vi.mocked(getPlanState).mockResolvedValue(plan === "free" ? { plan } : { plan, periodEnd: null, cancelAtPeriodEnd: false });
    const { container } = render(await page({ checkout: "success" }));
    expect(getSubscription).toHaveBeenCalledExactlyOnceWith(supabase, "private-user-id");
    expect(getPlanState).toHaveBeenCalledExactlyOnceWith("private-user-id", null, deps, { sync: true });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(plan === "pro" ? "Pro가 활성화됐어요" : "결제 반영 중…");
    expect(container.querySelector("main")?.firstElementChild).toBe(status);
  });

  it.each([{}, { checkout: "cancelled" }])("does not force sync or show a notice without success: %j", async (params) => {
    render(await page(params));
    expect(getPlanState).toHaveBeenCalledExactlyOnceWith("private-user-id", null, deps, { sync: false });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("passes the stored RLS subscription to the plan resolver", async () => {
    const stored = { plan: "pro" as const, currentPeriodEnd: "2026-11-13T00:00:00Z", cancelAtPeriodEnd: false };
    vi.mocked(getSubscription).mockResolvedValue(stored);
    render(await page());
    expect(getPlanState).toHaveBeenCalledExactlyOnceWith("private-user-id", stored, deps, { sync: false });
  });

  it("opens the pricing modal for Free after the landing action", async () => {
    render(await page({ upgrade: "pricing" }));
    expect(screen.getByRole("dialog")).toHaveFocus();
    expect(screen.getByRole("heading", { name: "카드 이용내역을 올려 주세요" })).toBeInTheDocument();
    expect(screen.getByText("업로드 패널")).toBeInTheDocument();
    expect(vi.mocked(PricingUpgrade).mock.calls[0][0]).toEqual({ teaser: null });
  });

  it("passes only Free teaser totals into the pricing modal with stored transactions", async () => {
    vi.mocked(listTransactions).mockResolvedValue(DEMO_TRANSACTIONS);
    render(await page({ upgrade: "pricing" }));
    expect(vi.mocked(PricingUpgrade).mock.calls[0][0]).toEqual({ teaser: freeDashboard.teaser });
    expect(screen.getByRole("dialog")).toHaveFocus();
    expect(screen.getByRole("dialog")).toHaveTextContent("내 이용내역에서 확인이 필요한 지출 4건 · 후보 합계 1,053,900원");
  });

  it("tells Pro that the plan is already active instead of opening the pricing modal", async () => {
    vi.mocked(getPlanState).mockResolvedValue({ plan: "pro", periodEnd: null, cancelAtPeriodEnd: false });
    render(await page({ upgrade: "pricing" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("이미 Pro를 쓰고 있어요");
  });

  it("shows no plan notice for Pro without the pricing action", async () => {
    vi.mocked(getPlanState).mockResolvedValue({ plan: "pro", periodEnd: null, cancelAtPeriodEnd: false });
    render(await page({}));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("uses the first array value for checkout and upgrade", async () => {
    render(await page({ checkout: ["success", "cancelled"], upgrade: ["pricing", "settings"] }));
    expect(getPlanState).toHaveBeenCalledExactlyOnceWith("private-user-id", null, deps, { sync: true });
    expect(screen.getByRole("status")).toHaveTextContent("결제 반영 중…");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("ignores later array values and other upgrade sources", async () => {
    render(await page({ checkout: ["cancelled", "success"], upgrade: ["settings", "pricing"] }));
    expect(getPlanState).toHaveBeenCalledExactlyOnceWith("private-user-id", null, deps, { sync: false });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
