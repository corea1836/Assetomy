import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PeriodSelect } from "./period-select";

const navigation = { push: vi.fn(), pathname: "/dashboard" };
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));

describe("PeriodSelect", () => {
  it("shows options in input order and selects the current value", () => {
    render(<PeriodSelect cardId="a" param="statement" value="2026-10-23" ariaLabel="명세서 선택" options={[
      { value: "2026-10-23", label: "2026년 10월 23일 명세서" },
      { value: "2026-09-23", label: "2026년 9월 23일 명세서" },
    ]} />);

    const select = screen.getByRole("combobox", { name: "명세서 선택" }) as HTMLSelectElement;
    expect(select.value).toBe("2026-10-23");
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      "2026년 10월 23일 명세서", "2026년 9월 23일 명세서",
    ]);
  });

  it.each([
    ["statement", "2026-10-23", "/dashboard?card=card+id%2F1&statement=2026-10-23"],
    ["month", "2026-09", "/dashboard?card=card+id%2F1&month=2026-09"],
  ] as const)("pushes a URLSearchParams URL when %s changes", (param, value, expected) => {
    navigation.push.mockClear();
    render(<PeriodSelect cardId="card id/1" param={param} value="old" ariaLabel="기간 선택" options={[
      { value: "old", label: "이전" }, { value, label: "새 기간" },
    ]} />);

    fireEvent.change(screen.getByRole("combobox", { name: "기간 선택" }), { target: { value } });
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith(expected);
  });
});
