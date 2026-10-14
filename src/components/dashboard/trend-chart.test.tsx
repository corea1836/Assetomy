import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trend } from "@/types/dashboard";
import { TrendChart } from "./trend-chart";

const trend: Trend = {
  months: [
    { month: "2026-07", total: 1_234_000, inProgress: false },
    { month: "2026-08", total: 1_312_000, inProgress: false },
    { month: "2026-09", total: 350_000, inProgress: true },
  ],
  categoryChanges: [
    { category: "food", current: 183_000, previous: 60_000, diff: 123_000 },
    { category: "shopping", current: 15_000, previous: 60_000, diff: -45_000 },
  ],
};

describe("TrendChart", () => {
  beforeEach(() => {
    // jsdom has no layout; size the container and text measurement separately.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.id === "recharts_measurement_span"
          ? new DOMRect(0, 0, 40, 12)
          : new DOMRect(0, 0, 640, 256);
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a real, accessibly labelled chart without throwing", () => {
    expect(() => render(<TrendChart trend={trend} />)).not.toThrow();

    expect(screen.getByRole("heading", { name: "월별 추세" })).toBeInTheDocument();
    const chart = screen.getByRole("img", { name: "월별 지출 추세 막대 차트" });
    expect(chart.querySelector("svg")).not.toBeNull();
    expect(within(chart).getByText("7월")).toBeInTheDocument();
    expect(within(chart).getByText("8월")).toBeInTheDocument();
    expect(within(chart).getByText("9월")).toBeInTheDocument();
  });

  it("keeps the chart inside role=img out of the keyboard focus order", () => {
    render(<TrendChart trend={trend} />);

    const svg = screen.getByRole("img", { name: "월별 지출 추세 막대 차트" }).querySelector("svg");
    expect(svg).not.toHaveAttribute("tabindex");
    expect(svg).not.toHaveAttribute("role", "application");
  });

  it("provides every month's full total in a screen-reader list", () => {
    render(<TrendChart trend={trend} />);

    const totals = screen.getByRole("list", { name: "월별 지출 합계" });
    expect(totals).toHaveClass("sr-only");
    const rows = within(totals).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("2026년 7월 1,234,000원");
    expect(rows[1]).toHaveTextContent("2026년 8월 1,312,000원");
    expect(rows[2]).toHaveTextContent("2026년 9월 350,000원");
    expect(rows[2]).toHaveTextContent("진행 중");
  });

  it("labels the in-progress month on its axis and uses a muted bar", () => {
    render(<TrendChart trend={trend} />);

    const chart = screen.getByRole("img", { name: "월별 지출 추세 막대 차트" });
    expect(within(chart).getByText("진행 중").closest("text")).toHaveTextContent("9월");
    const bars = chart.querySelectorAll(".recharts-bar-rectangle path");
    expect(bars).toHaveLength(3);
    expect(bars[0]).toHaveAttribute("fill", "var(--color-primary)");
    expect(bars[1]).toHaveAttribute("fill", "var(--color-primary)");
    expect(bars[2]).toHaveAttribute("fill", "var(--color-muted-soft)");
  });

  it("shows category increases and decreases with wording and text colors", () => {
    render(<TrendChart trend={trend} />);

    expect(screen.getByRole("heading", { name: "지난달과 달라진 카테고리" })).toBeInTheDocument();
    expect(screen.getByText("식비")).toBeInTheDocument();
    expect(screen.getByText("쇼핑")).toBeInTheDocument();
    const increase = screen.getByText(
      (_, element) => element?.tagName === "SPAN" && element.textContent?.includes("+123,000원 늘었어요") === true,
    );
    expect(increase).toHaveClass("text-increase", "whitespace-nowrap");
    expect(increase.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const decrease = screen.getByText(
      (_, element) => element?.tagName === "SPAN" && element.textContent?.includes("−45,000원 줄었어요") === true,
    );
    expect(decrease).toHaveClass("text-decrease", "whitespace-nowrap");
    expect(decrease.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("omits category changes when the DTO supplies null", () => {
    render(<TrendChart trend={{ ...trend, categoryChanges: null }} />);

    expect(screen.queryByRole("heading", { name: "지난달과 달라진 카테고리" })).not.toBeInTheDocument();
    expect(screen.queryByText(/늘었어요|줄었어요/)).not.toBeInTheDocument();
  });

  it("omits the in-progress notice for completed months", () => {
    render(<TrendChart trend={{ ...trend, months: trend.months.slice(0, 2) }} />);

    expect(screen.queryByText(/진행 중/)).not.toBeInTheDocument();
  });

  it("renders an empty trend without throwing", () => {
    expect(() => render(<TrendChart trend={{ months: [], categoryChanges: null }} />)).not.toThrow();

    expect(screen.getByRole("img", { name: "월별 지출 추세 막대 차트" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("does not add prohibited claims to the chart text", () => {
    const { container } = render(<TrendChart trend={trend} />);

    expect(container.textContent).not.toMatch(/절약|낭비|부정 결제|AI가 분석/);
  });
});
