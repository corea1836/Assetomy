import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CardDashboard, CardMonthView, CardStatementView, PeriodSnapshot, Snapshot } from "@/types/dashboard";
import type { CardOption } from "@/types/upload";
import { CardHeading } from "./card-heading";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const card: CardOption = {
  id: "card-1", label: "생활비 카드", issuer: "hyundai", analysisBasis: "month", cycleStartDay: null,
};
const period = { from: "2026-10-01", to: "2026-10-31" } as const;
const snapshot: Snapshot = {
  period, total: 1000, transactionCount: 1, cancelCount: 0, categories: [], topMerchants: [], otherMerchants: [], daily: [],
  month: "2026-10", inProgress: false,
};
const monthDashboard: CardDashboard = {
  card, plan: "free", flow: null, basis: "month", month: "2026-10",
  months: [{ month: "2026-10", period }], lastDate: "2026-10-15", snapshot, mom: null, partialMonth: null,
} satisfies CardMonthView & { card: CardOption; plan: "free"; flow: null };
const statementSnapshot: PeriodSnapshot = {
  period, total: 1000, transactionCount: 1, cancelCount: 0, categories: [], topMerchants: [], otherMerchants: [], daily: [],
};
const statementDashboard: CardDashboard = {
  card: { ...card, analysisBasis: "cycle", cycleStartDay: 12 }, plan: "free", flow: null, basis: "cycle",
  statementDate: "2026-10-23", statements: [{ statementDate: "2026-10-23", cyclePeriod: period }],
  cyclePeriod: { from: "2026-09-12", to: "2026-10-11" }, complete: true,
  snapshot: statementSnapshot, comparison: null, comparisonSkipped: false,
} satisfies CardStatementView & { card: CardOption; plan: "free"; flow: null };

describe("CardHeading", () => {
  it("shows a month selector, reflected-through date and card basis", () => {
    render(<CardHeading card={card} dashboard={monthDashboard} />);

    expect(screen.getByRole("heading", { name: "생활비 카드" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "월 선택" })).toHaveValue("2026-10");
    expect(screen.getByText("2026년 10월까지 반영됨")).toBeInTheDocument();
    expect(screen.getByText("현대카드 · 월별")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "새 이용내역 추가" })).toHaveAttribute("href", "#upload");
    expect(screen.getByRole("button", { name: "카드 수정" })).toBeInTheDocument();
  });

  it("shows a statement selector, cycle period and cycle basis", () => {
    const cycleCard = statementDashboard.card;
    render(<CardHeading card={cycleCard} dashboard={statementDashboard} />);

    expect(screen.getByRole("combobox", { name: "명세서 선택" })).toHaveValue("2026-10-23");
    expect(screen.getByText("이용 기간 9/12~10/11")).toBeInTheDocument();
    expect(screen.getByText("현대카드 · 이용 기간 매달 12일부터")).toBeInTheDocument();
  });

  it("shows the card name and basis without a period selector when data is absent", () => {
    render(<CardHeading card={card} dashboard={null} />);

    expect(screen.getByRole("heading", { name: "생활비 카드" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText(/까지 반영됨/)).not.toBeInTheDocument();
    expect(screen.getByText("현대카드 · 월별")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "카드 수정" })).toBeInTheDocument();
  });
});
