import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MonthOption } from "@/types/dashboard";
import { MonthSelect } from "./month-select";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  pathname: "/demo",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => navigation.pathname,
}));

const months: MonthOption[] = [
  { month: "2026-09", period: { from: "2026-09-01", to: "2026-09-30" } },
  { month: "2026-08", period: { from: "2026-08-01", to: "2026-08-31" } },
  { month: "2026-07", period: { from: "2026-07-01", to: "2026-07-31" } },
];

describe("MonthSelect", () => {
  beforeEach(() => {
    navigation.push.mockClear();
    navigation.pathname = "/demo";
  });

  it("labels months in the DTO order and selects the current month", () => {
    render(<MonthSelect months={months} month="2026-08" />);

    expect(screen.getByRole("combobox", { name: "월 선택" })).toHaveValue(
      "2026-08",
    );
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["2026년 9월", "2026년 8월", "2026년 7월"]);
    expect(
      screen.getAllByRole("option").map((option) => option.getAttribute("value")),
    ).toEqual(months.map(({ month }) => month));
  });

  it.each(["/demo", "/dashboard"])(
    "navigates to the selected month on the current path %s",
    (pathname) => {
      navigation.pathname = pathname;
      render(<MonthSelect months={months} month="2026-09" />);

      fireEvent.change(screen.getByRole("combobox", { name: "월 선택" }), {
        target: { value: "2026-07" },
      });

      expect(navigation.push).toHaveBeenCalledExactlyOnceWith(
        `${pathname}?month=2026-07`,
      );
    },
  );

  it("keeps the chosen month while navigating and follows the next month prop", () => {
    const { rerender } = render(<MonthSelect months={months} month="2026-09" />);
    const select = screen.getByRole("combobox", { name: "월 선택" });

    fireEvent.change(select, { target: { value: "2026-07" } });
    expect(screen.getByRole("combobox", { name: "월 선택" })).toHaveValue("2026-07");

    rerender(<MonthSelect months={months} month="2026-08" />);
    expect(screen.getByRole("combobox", { name: "월 선택" })).toHaveValue("2026-08");
  });
});
