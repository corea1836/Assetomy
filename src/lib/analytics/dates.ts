import type { IsoDate, YearMonth } from "@/types/transaction";

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function calendarMonthLength(year: number, month: number): number {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return month === 2 && leapYear ? 29 : MONTH_LENGTHS[month - 1];
}

export function monthOf(date: IsoDate): YearMonth {
  return date.slice(0, 7);
}

export function addMonths(month: YearMonth, n: number): YearMonth {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = year * 12 + monthNumber - 1 + n;
  const nextYear = Math.floor(shifted / 12);
  const nextMonth = shifted - nextYear * 12 + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}

export function daysInMonth(month: YearMonth): number {
  const [year, monthNumber] = month.split("-").map(Number);
  return calendarMonthLength(year, monthNumber);
}

export function datesOfMonth(month: YearMonth): IsoDate[] {
  return Array.from(
    { length: daysInMonth(month) },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
  );
}

export function datesBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  if (from > to) return [];

  const dates: IsoDate[] = [];
  let date = from;
  while (date <= to) {
    dates.push(date);
    const month = monthOf(date);
    const day = Number(date.slice(8, 10));
    date = day < daysInMonth(month)
      ? `${month}-${String(day + 1).padStart(2, "0")}`
      : `${addMonths(month, 1)}-01`;
  }
  return dates;
}

function dayNumber(date: IsoDate): number {
  const [year, month, day] = date.split("-").map(Number);
  const completedYears = year - 1;
  // 지난 해들의 평년 일수에 4·100·400년 주기의 윤일을 반영한다.
  let days =
    completedYears * 365 +
    Math.floor(completedYears / 4) -
    Math.floor(completedYears / 100) +
    Math.floor(completedYears / 400) +
    day;

  for (let previousMonth = 1; previousMonth < month; previousMonth += 1) {
    days += calendarMonthLength(year, previousMonth);
  }

  return days;
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return dayNumber(to) - dayNumber(from);
}
