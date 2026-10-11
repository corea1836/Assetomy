import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "@/types/dashboard";
import { TotalCard } from "./total-card";

const snapshot: Snapshot = {
  month: "2026-09",
  period: { from: "2026-09-01", to: "2026-09-30" },
  total: 1_234_000,
  transactionCount: 42,
  inProgress: false,
  categories: [],
  topMerchants: [],
  daily: [],
};

describe("TotalCard", () => {
  it("shows the total, transaction count, period and refund date notice", () => {
    render(<TotalCard snapshot={snapshot} mom={null} />);

    expect(screen.getByRole("heading", { name: "총지출" })).toBeInTheDocument();
    expect(screen.getByText("1,234,000원")).toHaveClass("font-mono");
    expect(
      screen.getByText("거래 42건 · 반영 기간 9/1~9/30"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("취소·환불은 카드사 파일의 날짜 기준으로 반영돼요"),
    ).toBeInTheDocument();
  });

  it.each([
    [123_000, "+123,000원 늘었어요", "text-increase"],
    [-45_000, "−45,000원 줄었어요", "text-decrease"],
    [0, "같아요", "text-body"],
  ] as const)(
    "describes a difference of %i with its color",
    (diff, text, color) => {
      render(
        <TotalCard
          snapshot={snapshot}
          mom={{
            previousMonth: "2026-08",
            previousTotal: snapshot.total - diff,
            diff,
          }}
        />,
      );

      expect(screen.getByText(/8월보다/)).toBeInTheDocument();
      expect(
        screen.getByText(
          (_, element) => element?.tagName === "SPAN" && element.textContent === text,
        ),
      ).toHaveClass(color);
    },
  );

  it("omits the comparison when mom is null", () => {
    render(<TotalCard snapshot={snapshot} mom={null} />);

    expect(screen.queryByText(/보다/)).not.toBeInTheDocument();
    expect(screen.queryByText(/늘었어요|줄었어요|같아요/)).not.toBeInTheDocument();
  });

  it("marks an in-progress month", () => {
    render(<TotalCard snapshot={{ ...snapshot, inProgress: true }} mom={null} />);

    expect(screen.getByText("진행 중인 달이에요")).toBeInTheDocument();
  });

  it("omits the in-progress notice for a completed month", () => {
    render(<TotalCard snapshot={snapshot} mom={null} />);

    expect(screen.queryByText("진행 중인 달이에요")).not.toBeInTheDocument();
  });

  it("uses a Unicode minus for a negative total", () => {
    render(<TotalCard snapshot={{ ...snapshot, total: -12_000 }} mom={null} />);

    expect(screen.getByText("−12,000원")).toHaveClass("font-mono");
    expect(screen.queryByText("-12,000원")).not.toBeInTheDocument();
  });
});
