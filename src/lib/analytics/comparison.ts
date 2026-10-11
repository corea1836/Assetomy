import { CATEGORY_IDS } from "@/types/category";
import type {
  CategoryChange,
  MonthOverMonth,
  Snapshot,
  Trend,
  TrendMonth,
} from "@/types/dashboard";
import type { IsoDate, Transaction, YearMonth } from "@/types/transaction";
import { addMonths, monthOf } from "./dates";
import { buildSnapshot, listDataMonths } from "./snapshot";

export const TREND_MAX_MONTHS = 12;

function snapshotForMonth(
  transactions: Transaction[],
  month: YearMonth,
  today: IsoDate,
): Snapshot | null {
  return transactions.some((transaction) => monthOf(transaction.date) === month)
    ? buildSnapshot(transactions, month, today)
    : null;
}

export function buildMonthOverMonth(
  transactions: Transaction[],
  month: YearMonth,
  today: IsoDate,
): MonthOverMonth | null {
  if (month >= monthOf(today)) return null;

  const previousMonth = addMonths(month, -1);
  const previous = snapshotForMonth(transactions, previousMonth, today);
  if (previous === null) return null;

  const current = snapshotForMonth(transactions, month, today);
  return {
    previousMonth,
    previousTotal: previous.total,
    diff: (current?.total ?? 0) - previous.total,
  };
}

function buildCategoryChanges(
  current: Snapshot | undefined,
  previous: Snapshot | undefined,
): CategoryChange[] {
  const currentTotals = new Map(
    current?.categories.map(({ category, amount }) => [category, amount]),
  );
  const previousTotals = new Map(
    previous?.categories.map(({ category, amount }) => [category, amount]),
  );

  return CATEGORY_IDS.map((category) => {
    const current = currentTotals.get(category) ?? 0;
    const previous = previousTotals.get(category) ?? 0;
    return { category, current, previous, diff: current - previous };
  })
    .filter((change) => change.diff !== 0)
    .sort((a, b) =>
      Math.abs(b.diff) - Math.abs(a.diff)
        || CATEGORY_IDS.indexOf(a.category) - CATEGORY_IDS.indexOf(b.category),
    );
}

export function buildTrend(
  transactions: Transaction[],
  month: YearMonth,
  today: IsoDate,
): Trend | null {
  const dataMonths = listDataMonths(transactions);
  if (dataMonths.length === 0) return null;

  const earliestMonth = dataMonths[dataMonths.length - 1].month;
  const windowStart = addMonths(month, -(TREND_MAX_MONTHS - 1));
  const start = earliestMonth > windowStart ? earliestMonth : windowStart;
  const monthsWithData = dataMonths.filter(
    (item) => item.month >= start && item.month <= month,
  );
  if (monthsWithData.length < 2) return null;

  const snapshots = new Map(
    monthsWithData.map((item) => [
      item.month,
      buildSnapshot(transactions, item.month, today),
    ]),
  );
  const currentMonth = monthOf(today);
  const months: TrendMonth[] = [];
  for (let m = start; m <= month; m = addMonths(m, 1)) {
    months.push({
      month: m,
      total: snapshots.get(m)?.total ?? 0,
      inProgress: m >= currentMonth,
    });
  }

  const mom = buildMonthOverMonth(transactions, month, today);
  return {
    months,
    categoryChanges: mom === null
      ? null
      : buildCategoryChanges(snapshots.get(month), snapshots.get(mom.previousMonth)),
  };
}
