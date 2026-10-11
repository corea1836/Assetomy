import type { Period } from "@/types/dashboard";
import type { IsoDate, YearMonth } from "@/types/transaction";

const numberFormat = new Intl.NumberFormat("ko-KR");
const axisNumberFormat = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 1,
});

export function formatWon(amount: number): string {
  return `${amount < 0 ? "−" : ""}${numberFormat.format(Math.abs(amount))}원`;
}

export function formatSignedWon(amount: number): string {
  return `${amount > 0 ? "+" : ""}${formatWon(amount)}`;
}

export function formatAxisWon(amount: number): string {
  const absolute = Math.abs(amount);
  const sign = amount < 0 ? "−" : "";

  if (absolute >= 10_000) {
    return `${sign}${axisNumberFormat.format(absolute / 10_000)}만`;
  }

  return `${sign}${numberFormat.format(absolute)}`;
}

export function formatRatio(ratio: number): string {
  if (ratio > 0 && ratio < 0.005) return "1% 미만";

  const percent = Math.round(ratio * 100);
  return `${percent < 0 ? "−" : ""}${numberFormat.format(Math.abs(percent))}%`;
}

export function formatMonth(month: YearMonth): string {
  const [year, monthNumber] = month.split("-");
  return `${year}년 ${Number(monthNumber)}월`;
}

export function formatMonthShort(month: YearMonth): string {
  return `${Number(month.split("-")[1])}월`;
}

export function formatDate(date: IsoDate): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

function formatPeriodDate(date: IsoDate, includeYear: boolean): string {
  const [year, month, day] = date.split("-");
  return `${includeYear ? `${year}/` : ""}${Number(month)}/${Number(day)}`;
}

export function formatPeriod(period: Period): string {
  const includeYear = period.from.slice(0, 4) !== period.to.slice(0, 4);
  return `${formatPeriodDate(period.from, includeYear)}~${formatPeriodDate(period.to, includeYear)}`;
}
