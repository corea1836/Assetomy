import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyAmount } from "@/types/dashboard";
import { DailyChart } from "./daily-chart";

const daily: DailyAmount[] = [
  { date: "2026-09-01", amount: 15_000 },
  { date: "2026-09-02", amount: 0 },
  { date: "2026-09-03", amount: -12_000 },
];

describe("DailyChart", () => {
  beforeEach(() => {
    // jsdom has no layout; give the real responsive chart measurable bounds.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 640, 256),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the real chart without throwing and labels it accessibly", () => {
    expect(() => render(<DailyChart daily={daily} />)).not.toThrow();

    expect(
      screen.getByRole("heading", { name: "일별 지출" }),
    ).toBeInTheDocument();
    const chart = screen.getByRole("img", { name: "일별 지출 막대 차트" });
    expect(chart).toBeInTheDocument();
    expect(chart.querySelector("svg")).not.toBeNull();
  });

  it("renders an empty DTO without throwing", () => {
    expect(() => render(<DailyChart daily={[]} />)).not.toThrow();

    expect(
      screen.getByRole("img", { name: "일별 지출 막대 차트" }),
    ).toBeInTheDocument();
  });
});
