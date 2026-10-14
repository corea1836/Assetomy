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
import { buildCardDashboard, buildDashboard } from "@/lib/analytics/dashboard";
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
import { listStatements } from "@/lib/queries/statements";
import { listSummaryFeedback } from "@/lib/queries/summary-feedback";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { defaultSummaryDeps } from "@/lib/summary/deps";
import { defaultCardSummaryDeps } from "@/lib/summary/deps";
import type { SummaryDeps } from "@/lib/summary/monthly-summary";
import type { CardSummaryDeps } from "@/lib/summary/card-summary";
import { prepareCardSummary } from "@/lib/summary/card-summary";
import { prepareSummary } from "@/lib/summary/monthly-summary";
import { UploadHistory } from "@/components/upload/upload-history";
import { UploadPanel } from "@/components/upload/upload-panel";
import { MonthlySummarySection } from "./monthly-summary-section";
import { CardSummarySection } from "./card-summary-section";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FreeDashboard, ProDashboard } from "@/types/dashboard";
import DashboardPage, { metadata } from "./page";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/billing/deps", () => ({ defaultBillingDeps: vi.fn() }));
vi.mock("@/lib/summary/deps", () => ({ defaultSummaryDeps: vi.fn(), defaultCardSummaryDeps: vi.fn() }));
vi.mock("@/lib/summary/card-summary", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/summary/card-summary")>();
  return { ...original, prepareCardSummary: vi.fn(original.prepareCardSummary) };
});
vi.mock("@/lib/summary/monthly-summary", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/summary/monthly-summary")>();
  return { ...original, prepareSummary: vi.fn(original.prepareSummary) };
});
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
vi.mock("@/lib/queries/statements", () => ({ listStatements: vi.fn() }));
vi.mock("@/lib/queries/summary-feedback", () => ({ listSummaryFeedback: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/components/upload/upload-panel", () => ({ UploadPanel: vi.fn(() => <div>업로드 패널</div>) }));
vi.mock("@/components/upload/upload-history", () => ({ UploadHistory: vi.fn(() => <div>올린 파일 목록</div>) }));
vi.mock("./monthly-summary-section", () => ({
  MonthlySummarySection: vi.fn(() => <section><h2>이번 달 요약</h2></section>),
}));
vi.mock("./card-summary-section", () => ({
  CardSummarySection: vi.fn(({ variant }: { variant: "card-month" | "statement" }) => (
    <section><h2>{variant === "statement" ? "이번 명세서 요약" : "이번 달 요약"}</h2><p>카드 요약 섹션</p></section>
  )),
}));
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
const summaryDeps = {
  summarizer: {
    modelFor: (plan: "free" | "pro") => plan === "free" ? "test-free-model" : "test-pro-model",
    promptFor: (plan: "free" | "pro") => `${plan} prompt`,
  },
} as unknown as SummaryDeps;
const cards = [{ id: "card-a", label: "현대 생활비", issuer: "hyundai" as const, analysisBasis: "month" as const, cycleStartDay: null }];
const cardPageId = "11111111-1111-4111-8111-111111111111";
const monthCard = { id: cardPageId, label: "현대", issuer: "hyundai" as const, analysisBasis: "month" as const, cycleStartDay: null };
const cycleCard = { id: cardPageId, label: "현대", issuer: "hyundai" as const, analysisBasis: "cycle" as const, cycleStartDay: 12 };
const cardSummaryDeps = {
  summarizer: {
    modelFor: (plan: "free" | "pro") => plan === "free" ? "test-free-card-model" : "test-pro-card-model",
    promptFor: (plan: "free" | "pro") => `${plan} card prompt`,
  },
} as unknown as CardSummaryDeps;
const freeDashboard = buildDashboard({ transactions: DEMO_TRANSACTIONS, plan: "free", today: DEMO_TODAY }) as FreeDashboard;
const proDashboard = buildDashboard({ transactions: DEMO_TRANSACTIONS, plan: "pro", today: DEMO_TODAY }) as ProDashboard;

function page(params: Record<string, string | string[] | undefined> = {}) {
  return DashboardPage({ searchParams: Promise.resolve(params) });
}

function transactionsForCard() {
  return DEMO_TRANSACTIONS.map((transaction) => ({ ...transaction, cardId: cardPageId, cardLabel: monthCard.label }));
}

function statementTransactions() {
  const [previous, current] = DEMO_TRANSACTIONS;
  return [
    { ...previous, id: "previous-statement-transaction", cardId: cardPageId, cardLabel: cycleCard.label, date: "2026-08-20", statementDate: "2026-09-23", merchant: "이전 가맹점", merchantKey: "previous", amount: 1_000, category: "food" as const },
    { ...current, id: "current-statement-transaction", cardId: cardPageId, cardLabel: cycleCard.label, date: "2026-09-20", statementDate: "2026-10-23", merchant: "현재 가맹점", merchantKey: "current", amount: 2_200, category: "cafe" as const },
  ];
}

const completeStatements = [
  { cardId: cardPageId, statementDate: "2026-09-23", savedOn: "2026-09-23" },
  { cardId: cardPageId, statementDate: "2026-10-23", savedOn: "2026-10-23" },
];

beforeEach(() => {
  vi.mocked(requireUser).mockReset().mockResolvedValue({ id: "private-user-id" });
  vi.mocked(createSupabaseServerClient).mockReset().mockResolvedValue(supabase);
  vi.mocked(listCards).mockReset().mockResolvedValue(cards);
  vi.mocked(listTransactions).mockReset().mockResolvedValue([]);
  vi.mocked(seoulToday).mockReset().mockReturnValue(DEMO_TODAY);
  vi.mocked(listDoneUploads).mockReset().mockResolvedValue([]);
  vi.mocked(listStatements).mockReset().mockResolvedValue([]);
  vi.mocked(listSummaryFeedback).mockReset().mockResolvedValue({});
  vi.mocked(getSubscription).mockReset().mockResolvedValue(null);
  vi.mocked(defaultBillingDeps).mockReset().mockReturnValue(deps);
  vi.mocked(defaultSummaryDeps).mockReset().mockReturnValue(summaryDeps);
  vi.mocked(defaultCardSummaryDeps).mockReset().mockReturnValue(cardSummaryDeps);
  vi.mocked(getPlanState).mockReset().mockResolvedValue({ plan: "free" });
  vi.mocked(UploadPanel).mockClear();
  vi.mocked(UploadHistory).mockClear();
  vi.mocked(MonthlySummarySection).mockClear();
  vi.mocked(CardSummarySection).mockClear();
  vi.mocked(prepareCardSummary).mockClear();
  vi.mocked(prepareSummary).mockClear();
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

  it("shows the Free monthly dashboard with cancellation pairs (ADR-025) and only teaser totals", async () => {
    vi.mocked(listTransactions).mockResolvedValue(DEMO_TRANSACTIONS);
    const { container } = render(await page());
    expect(within(screen.getByRole("navigation", { name: "카드 보기" })).getByRole("link", { name: "전체" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1, name: "2026년 9월 지출" })).toBeInTheDocument();
    expect(screen.getByText("2026년 9월까지 반영됨")).toBeInTheDocument();
    const total = screen.getByRole("heading", { name: "총지출" }).closest("section")!;
    expect(within(total).getByText(formatWon(freeDashboard.snapshot.total))).toBeInTheDocument();
    expect(within(total).getByText("거래 24건 · 반영 기간 9/1~9/30")).toBeInTheDocument();
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
    expect(container).not.toHaveTextContent(/월별 대시보드는 준비하고 있어요|여기부터 Pro 화면이에요|내 카드로 확인해 보세요/);
    expect(container).not.toHaveTextContent("private-user-id");
  });

  it("builds a Free summary input from the Free dashboard DTO only", async () => {
    vi.mocked(listTransactions).mockResolvedValue(DEMO_TRANSACTIONS);
    const feedback = { food: "평일 점심은 회사에서 먹어요" };
    vi.mocked(listSummaryFeedback).mockResolvedValue(feedback);
    render(await page());

    expect(defaultSummaryDeps).toHaveBeenCalledExactlyOnceWith(supabase);
    const [props] = vi.mocked(MonthlySummarySection).mock.calls[0];
    expect(props.userId).toBe("private-user-id");
    expect(props.prepared.plan).toBe("free");
    expect(props.prepared.month).toBe(freeDashboard.month);
    expect(vi.mocked(listSummaryFeedback)).toHaveBeenCalledExactlyOnceWith(supabase, "private-user-id");
    expect(vi.mocked(prepareSummary).mock.calls[0][2]).toBe(feedback);
    expect(props.prepared.input.categories.find(({ category }) => category === "식비")?.feedback)
      .toBe("평일 점심은 회사에서 먹어요");
    expect("findings" in props.prepared.input).toBe(false);
    expect(props.deps).toBe(summaryDeps);
  });

  it("builds a Pro summary input from the Pro dashboard DTO", async () => {
    vi.mocked(listTransactions).mockResolvedValue(DEMO_TRANSACTIONS);
    vi.mocked(getPlanState).mockResolvedValue({ plan: "pro", periodEnd: null, cancelAtPeriodEnd: false });
    render(await page());

    expect(defaultSummaryDeps).toHaveBeenCalledExactlyOnceWith(supabase);
    const [props] = vi.mocked(MonthlySummarySection).mock.calls[0];
    expect(props.userId).toBe("private-user-id");
    expect(props.prepared.plan).toBe("pro");
    expect(props.prepared.month).toBe(proDashboard.month);
    expect("findings" in props.prepared.input).toBe(true);
    expect(props.deps).toBe(summaryDeps);
  });

  it("renders a monthly card view without preparing the overall summary, findings or trend", async () => {
    vi.mocked(listCards).mockResolvedValue([monthCard]);
    const transactions = transactionsForCard();
    vi.mocked(listTransactions).mockResolvedValue(transactions);

    render(await page({ card: cardPageId, month: "2026-09" }));

    expect(within(screen.getByRole("navigation", { name: "카드 보기" })).getByRole("link", { name: "현대" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1, name: "현대" })).toBeInTheDocument();
    expect(screen.getByText("현대카드 · 월별")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "월 선택" })).toHaveValue("2026-09");
    expect(screen.getByText("카드 요약 섹션")).toBeInTheDocument();
    const expected = buildCardDashboard({ card: monthCard, transactions, statements: [], plan: "free", month: "2026-09", today: DEMO_TODAY })!;
    const total = screen.getByRole("heading", { name: "총지출" }).closest("section")!;
    expect(within(total).getByText(formatWon(expected.snapshot.total))).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "2026년 9월 지출" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "후보 지출 티저" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "확인할 지출 상세" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "월별 추세" })).not.toBeInTheDocument();
    expect(defaultSummaryDeps).not.toHaveBeenCalled();
    expect(MonthlySummarySection).not.toHaveBeenCalled();
    expect(defaultCardSummaryDeps).toHaveBeenCalledExactlyOnceWith(supabase);
    expect(listStatements).toHaveBeenCalledExactlyOnceWith(supabase, "private-user-id");
    expect(vi.mocked(CardSummarySection).mock.calls[0][0].variant).toBe("card-month");
    const [preparedCardDTO] = vi.mocked(prepareCardSummary).mock.calls[0];
    expect(preparedCardDTO.plan).toBe("free");
    expect("categoryChanges" in preparedCardDTO).toBe(false);
  });

  it("renders a statement card view and gives its summary the statement variant", async () => {
    vi.mocked(listCards).mockResolvedValue([cycleCard]);
    vi.mocked(listTransactions).mockResolvedValue(statementTransactions());
    vi.mocked(listStatements).mockResolvedValue(completeStatements);

    render(await page({ card: cardPageId, statement: "2026-10-23" }));

    expect(screen.getByRole("heading", { level: 1, name: "현대" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "명세서 선택" })).toHaveValue("2026-10-23");
    expect(screen.getByRole("heading", { name: "이번 명세서 요약" })).toBeInTheDocument();
    expect(vi.mocked(CardSummarySection).mock.calls[0][0].variant).toBe("statement");
    expect(screen.getAllByText("이용 기간 9/12~10/11")).toHaveLength(2);
    const total = screen.getByRole("heading", { name: "총지출" }).closest("section")!;
    expect(within(total).getByText(formatWon(2_200))).toBeInTheDocument();
    expect(total).toHaveTextContent("9월 23일 명세서보다 +1,200원 늘었어요");
  });

  it.each(["free", "pro"] as const)("passes only the %s card DTO to card summary preparation", async (plan) => {
    vi.mocked(listCards).mockResolvedValue([cycleCard]);
    vi.mocked(listTransactions).mockResolvedValue(statementTransactions());
    vi.mocked(listStatements).mockResolvedValue(completeStatements);
    vi.mocked(getPlanState).mockResolvedValue(plan === "free" ? { plan } : { plan, periodEnd: null, cancelAtPeriodEnd: false });

    render(await page({ card: cardPageId, statement: "2026-10-23" }));

    const [cardDTO] = vi.mocked(prepareCardSummary).mock.calls[0];
    if (plan === "free") {
      expect(screen.queryByRole("heading", { name: "지난 명세서와 달라진 카테고리" })).not.toBeInTheDocument();
      expect("categoryChanges" in cardDTO).toBe(false);
    } else {
      expect(screen.getByRole("heading", { name: "지난 명세서와 달라진 카테고리" })).toBeInTheDocument();
      expect("categoryChanges" in cardDTO).toBe(true);
      if ("categoryChanges" in cardDTO) expect(cardDTO.categoryChanges).toHaveLength(2);
    }
    expect(vi.mocked(prepareCardSummary).mock.calls[0][2]).toEqual({});
  });

  it("falls back to the overall tab for an unknown or malformed card id", async () => {
    vi.mocked(listTransactions).mockResolvedValue(DEMO_TRANSACTIONS);

    for (const card of ["22222222-2222-4222-8222-222222222222", "not-a-card-id"]) {
      const view = render(await page({ card }));
      expect(within(screen.getByRole("navigation", { name: "카드 보기" })).getByRole("link", { name: "전체" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("heading", { name: "2026년 9월 지출" })).toBeInTheDocument();
      view.unmount();
    }
  });

  it("shows an empty card and edit control without preparing a card summary", async () => {
    const emptyCard = { ...monthCard, id: "22222222-2222-4222-8222-222222222222", label: "저축" };
    vi.mocked(listCards).mockResolvedValue([monthCard, emptyCard]);
    vi.mocked(listTransactions).mockResolvedValue(transactionsForCard());

    render(await page({ card: emptyCard.id }));

    expect(screen.getByRole("heading", { level: 1, name: "저축" })).toBeInTheDocument();
    expect(screen.getByText("이 카드로 올린 내역이 아직 없어요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "카드 수정" })).toBeInTheDocument();
    expect(CardSummarySection).not.toHaveBeenCalled();
    expect(defaultCardSummaryDeps).not.toHaveBeenCalled();
    expect(defaultSummaryDeps).not.toHaveBeenCalled();
  });

  it("keeps onboarding when a card is requested without any transactions", async () => {
    vi.mocked(listCards).mockResolvedValue([monthCard]);

    render(await page({ card: cardPageId }));

    expect(screen.getByRole("heading", { level: 1, name: "카드 이용내역을 올려 주세요" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "카드 보기" })).not.toBeInTheDocument();
    expect(CardSummarySection).not.toHaveBeenCalled();
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
    const order = ["2026년 9월 지출", "이번 달 요약", "총지출", "카테고리", "가장 많이 쓴 곳", "일별 지출", "후보 지출 티저", "추세 잠금 카드", "새 이용내역 추가"];
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
    [{ card: cardPageId.toUpperCase(), statement: "2026-10-23" }, `/dashboard?card=${cardPageId}&statement=2026-10-23`],
    [{ card: [cardPageId, "22222222-2222-4222-8222-222222222222"], statement: ["2026-10-23", "2026-09-23"] }, `/dashboard?card=${cardPageId}&statement=2026-10-23`],
    [{ card: cardPageId, statement: "2026-1-1" }, `/dashboard?card=${cardPageId}`],
    [{ card: "not-a-card-id", statement: "2026-1-1" }, "/dashboard"],
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
    expect(defaultSummaryDeps).not.toHaveBeenCalled();
    expect(MonthlySummarySection).not.toHaveBeenCalled();
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
