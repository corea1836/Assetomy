import { describe, expect, it } from "vitest";
import {
  formatAxisWon,
  formatCardBasis,
  formatDate,
  formatMonth,
  formatMonthShort,
  formatPeriod,
  formatRatio,
  formatSignedWon,
  formatStatementDate,
  formatStatementOption,
  formatWon,
} from "./format";

describe("formatWon", () => {
  it.each([
    [1_234_000, "1,234,000원"],
    [-12_000, "−12,000원"],
    [15_000, "15,000원"],
    [0, "0원"],
    [-0, "0원"],
  ] as const)("formats %i in full won units", (amount, expected) => {
    expect(formatWon(amount)).toBe(expected);
  });

  it("uses the Unicode minus sign for negative amounts", () => {
    expect(formatWon(-12_000)[0]).toBe("−");
  });
});

describe("formatSignedWon", () => {
  it.each([
    [123_000, "+123,000원"],
    [-45_000, "−45,000원"],
    [1_234_000, "+1,234,000원"],
    [0, "0원"],
    [-0, "0원"],
  ] as const)("formats %i with a sign only when nonzero", (amount, expected) => {
    expect(formatSignedWon(amount)).toBe(expected);
  });
});

describe("formatAxisWon", () => {
  it.each([
    [1_200_000, "120만"],
    [15_000, "1.5만"],
    [5_000, "5,000"],
    [0, "0"],
    [-0, "0"],
    [10_000, "1만"],
    [9_999, "9,999"],
    [-30_000, "−3만"],
    [-9_999, "−9,999"],
    [10_499, "1만"],
    [10_500, "1.1만"],
    [-10_500, "−1.1만"],
    [99_999, "10만"],
  ] as const)("formats chart tick %i", (amount, expected) => {
    expect(formatAxisWon(amount)).toBe(expected);
  });
});

describe("formatRatio", () => {
  it.each([
    [0.1234, "12%"],
    [0.003, "1% 미만"],
    [-0.05, "−5%"],
    [0, "0%"],
    [-0, "0%"],
    [0.004999, "1% 미만"],
    [0.005, "1%"],
    [0.125, "13%"],
    [0.9999, "100%"],
    [-0.003, "0%"],
  ] as const)("formats ratio %s as a rounded percentage", (ratio, expected) => {
    expect(formatRatio(ratio)).toBe(expected);
  });
});

describe("formatMonth", () => {
  it.each([
    ["2026-09", "2026년 9월"],
    ["2026-01", "2026년 1월"],
    ["2025-12", "2025년 12월"],
  ])("formats month %s", (month, expected) => {
    expect(formatMonth(month)).toBe(expected);
  });
});

describe("formatMonthShort", () => {
  it.each([
    ["2026-09", "9월"],
    ["2026-01", "1월"],
    ["2025-12", "12월"],
  ])("formats month %s without the year", (month, expected) => {
    expect(formatMonthShort(month)).toBe(expected);
  });
});

describe("formatDate", () => {
  it.each([
    ["2026-09-05", "9월 5일"],
    ["2026-01-01", "1월 1일"],
    ["2025-12-31", "12월 31일"],
    ["2024-02-29", "2월 29일"],
  ])("formats date %s without leading zeroes", (date, expected) => {
    expect(formatDate(date)).toBe(expected);
  });
});

describe("formatStatementDate", () => {
  it.each([
    ["2026-10-23", "10월 23일 명세서"],
    ["2026-01-05", "1월 5일 명세서"],
  ] as const)("formats %s without leading zeroes", (date, expected) => {
    expect(formatStatementDate(date)).toBe(expected);
  });
});

describe("card formatting", () => {
  it("formats a statement option with its year", () => {
    expect(formatStatementOption("2026-10-23")).toBe("2026년 10월 23일 명세서");
  });

  it.each([
    [{ issuer: "hyundai", analysisBasis: "month", cycleStartDay: null }, "현대카드 · 월별"],
    [{ issuer: "shinhan", analysisBasis: "cycle", cycleStartDay: 12 }, "신한카드 · 이용 기간 매달 12일부터"],
  ] as const)("formats a card basis: %o", (card, expected) => {
    expect(formatCardBasis(card)).toBe(expected);
  });
});

describe("formatPeriod", () => {
  it.each([
    [{ from: "2026-09-01", to: "2026-09-30" }, "9/1~9/30"],
    [{ from: "2025-12-28", to: "2026-01-03" }, "2025/12/28~2026/1/3"],
    [{ from: "2026-08-28", to: "2026-09-03" }, "8/28~9/3"],
    [{ from: "2026-09-05", to: "2026-09-05" }, "9/5~9/5"],
  ])("formats period %o", (period, expected) => {
    expect(formatPeriod(period)).toBe(expected);
  });
});
