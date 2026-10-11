import { describe, expect, it } from "vitest";
import {
  addMonths,
  datesOfMonth,
  daysBetween,
  daysInMonth,
  monthOf,
} from "./dates";

describe("monthOf", () => {
  it.each([
    ["2026-09-15", "2026-09"],
    ["2026-01-01", "2026-01"],
    ["2025-12-31", "2025-12"],
  ])("returns the month of %s", (date, expected) => {
    expect(monthOf(date)).toBe(expected);
  });
});

describe("addMonths", () => {
  it.each([
    ["2026-01", -1, "2025-12"],
    ["2025-12", 1, "2026-01"],
    ["2026-03", -14, "2025-01"],
    ["2026-09", 0, "2026-09"],
    ["2026-09", 24, "2028-09"],
    ["2026-01", -25, "2023-12"],
    ["0099-12", 1, "0100-01"],
  ] as const)("shifts %s by %i months", (month, n, expected) => {
    expect(addMonths(month, n)).toBe(expected);
  });
});

describe("daysInMonth", () => {
  it.each([
    ["2026-01", 31],
    ["2026-02", 28],
    ["2026-03", 31],
    ["2026-04", 30],
    ["2026-05", 31],
    ["2026-06", 30],
    ["2026-07", 31],
    ["2026-08", 31],
    ["2026-09", 30],
    ["2026-10", 31],
    ["2026-11", 30],
    ["2026-12", 31],
    ["2024-02", 29],
    ["2025-02", 28],
    ["2000-02", 29],
    ["2100-02", 28],
  ] as const)("returns the length of %s", (month, expected) => {
    expect(daysInMonth(month)).toBe(expected);
  });
});

describe("datesOfMonth", () => {
  it("lists every date in February 2026 in order", () => {
    expect(datesOfMonth("2026-02")).toEqual([
      "2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04",
      "2026-02-05", "2026-02-06", "2026-02-07", "2026-02-08",
      "2026-02-09", "2026-02-10", "2026-02-11", "2026-02-12",
      "2026-02-13", "2026-02-14", "2026-02-15", "2026-02-16",
      "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20",
      "2026-02-21", "2026-02-22", "2026-02-23", "2026-02-24",
      "2026-02-25", "2026-02-26", "2026-02-27", "2026-02-28",
    ]);
  });

  it.each([
    ["2024-02", 29, "2024-02-29"],
    ["2026-04", 30, "2026-04-30"],
    ["2026-12", 31, "2026-12-31"],
  ] as const)("includes the first and last day of %s", (month, count, last) => {
    const dates = datesOfMonth(month);
    expect(dates).toHaveLength(count);
    expect(dates[0]).toBe(`${month}-01`);
    expect(dates[count - 1]).toBe(last);
    expect(new Set(dates).size).toBe(count);
  });
});

describe("daysBetween", () => {
  it.each([
    ["2025-12-31", "2026-01-01", 1],
    ["2024-02-01", "2024-03-01", 29],
    ["2026-03-01", "2026-02-01", -28],
    ["2026-09-15", "2026-09-15", 0],
    ["2000-02-28", "2000-03-01", 2],
    ["2100-02-28", "2100-03-01", 1],
    ["2025-01-01", "2026-01-01", 365],
    ["2024-01-01", "2025-01-01", 366],
    ["2000-01-01", "2400-01-01", 146097],
    ["0099-12-31", "0100-01-01", 1],
  ] as const)("counts days from %s to %s", (from, to, expected) => {
    expect(daysBetween(from, to)).toBe(expected);
  });
});
