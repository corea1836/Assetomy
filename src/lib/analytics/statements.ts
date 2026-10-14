import type { Period } from "@/types/dashboard";
import type { IsoDate, YearMonth } from "@/types/transaction";
import { addMonths, daysInMonth, monthOf } from "./dates";

function cycleStartDate(month: YearMonth, cycleStartDay: number): IsoDate {
  const day = Math.min(cycleStartDay, daysInMonth(month));
  return `${month}-${String(day).padStart(2, "0")}`;
}

function previousDate(date: IsoDate): IsoDate {
  const month = monthOf(date);
  const day = Number(date.slice(8, 10));
  if (day > 1) return `${month}-${String(day - 1).padStart(2, "0")}`;

  const previousMonth = addMonths(month, -1);
  return `${previousMonth}-${String(daysInMonth(previousMonth)).padStart(2, "0")}`;
}

// 결제일보다 앞서 시작한 마지막 주기의 직전 이용 기간을 돌려준다.
export function statementCyclePeriod(
  statementDate: IsoDate,
  cycleStartDay: number,
): Period {
  const statementMonth = monthOf(statementDate);
  const currentStart = cycleStartDate(statementMonth, cycleStartDay);
  const startMonth = currentStart <= statementDate
    ? statementMonth
    : addMonths(statementMonth, -1);
  const start = cycleStartDate(startMonth, cycleStartDay);
  const previousStart = cycleStartDate(addMonths(startMonth, -1), cycleStartDay);

  return { from: previousStart, to: previousDate(start) };
}
