import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PeriodSnapshot } from "@/types/dashboard";
import { StatementTotalCard } from "./statement-total-card";

const snapshot: PeriodSnapshot = {
  period: { from: "2026-08-12", to: "2026-09-12" }, total: 123_000, transactionCount: 7, cancelCount: 0,
  categories: [], topMerchants: [], otherMerchants: [], daily: [],
};
const cyclePeriod = { from: "2026-08-12", to: "2026-09-11" };

describe("StatementTotalCard", () => {
  it.each([
    [{ previousStatementDate: "2026-08-23", previousTotal: 100_000, diff: 23_000 }, "+23,000원 늘었어요", "text-increase"],
    [{ previousStatementDate: "2026-08-23", previousTotal: 140_000, diff: -17_000 }, "−17,000원 줄었어요", "text-decrease"],
  ] as const)("shows statement comparison %o", (comparison, message, color) => {
    render(<StatementTotalCard snapshot={snapshot} cyclePeriod={cyclePeriod} complete comparison={comparison} comparisonSkipped={false} />);

    const text = screen.getByText((_, element) => element?.textContent === `8월 23일 명세서보다 ${message}`);
    expect(text).toHaveClass("mt-3", "text-sm", "tabular-nums", "text-body");
    expect(text.querySelector("span")).toHaveClass(color);
  });

  it("shows equality with the previous statement date", () => {
    render(<StatementTotalCard snapshot={snapshot} cyclePeriod={cyclePeriod} complete comparison={{
      previousStatementDate: "2026-08-23", previousTotal: 123_000, diff: 0,
    }} comparisonSkipped={false} />);

    expect(screen.getByText("8월 23일 명세서와 같아요")).toBeInTheDocument();
  });

  it("explains a skipped comparison and shows the snapshot and cycle evidence", () => {
    render(<StatementTotalCard snapshot={snapshot} cyclePeriod={cyclePeriod} complete={false} comparison={null} comparisonSkipped />);

    expect(screen.getByText("이용 기간이 끝나기 전에 받은 명세서가 있어 지난 명세서와 비교하지 않았어요")).toBeInTheDocument();
    expect(screen.getByText("거래 7건 · 반영 기간 8/12~9/12")).toBeInTheDocument();
    expect(screen.getByText("이용 기간 8/12~9/11")).toBeInTheDocument();
    expect(screen.getByText("취소·환불은 카드사 파일의 날짜 기준으로 반영돼요")).toBeInTheDocument();
    expect(screen.getByText("이용 기간이 끝나기 전에 받은 명세서예요. 그 뒤 거래는 빠져 있을 수 있어요")).toBeInTheDocument();
    expect(screen.getByText("거래 7건 · 반영 기간 8/12~9/12").parentElement).toHaveClass("border-t", "border-hairline-soft");
  });

  it("includes cancellation pairs in statement evidence only when present", () => {
    const { rerender } = render(<StatementTotalCard snapshot={{ ...snapshot, cancelCount: 1 }} cyclePeriod={cyclePeriod} complete comparison={null} comparisonSkipped={false} />);
    expect(screen.getByText("거래 7건 · 취소 1건 · 반영 기간 8/12~9/12")).toBeInTheDocument();

    rerender(<StatementTotalCard snapshot={{ ...snapshot, transactionCount: 0, cancelCount: 1 }} cyclePeriod={cyclePeriod} complete comparison={null} comparisonSkipped={false} />);
    expect(screen.getByText("거래 0건 · 취소 1건 · 반영 기간 8/12~9/12")).toBeInTheDocument();
  });
});
