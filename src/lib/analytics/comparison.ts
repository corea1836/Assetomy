import { CATEGORY_IDS } from "@/types/category";
import type {
  CategoryChange,
  MonthOverMonth,
  PeriodSnapshot,
  Snapshot,
  Trend,
  TrendMonth,
} from "@/types/dashboard";
import type { IsoDate, Transaction, YearMonth } from "@/types/transaction";
import { addMonths, daysBetween, daysInMonth, monthOf } from "./dates";
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

// 명세서 이용 기간은 카드·결제일마다 다르고 파일에 없어서, 카드별 첫·마지막 거래일로 내역이 있는 기간을 본다.
// 달 경계와 이만큼 어긋나는 것은 덮은 것으로 본다(그날 거래가 없었거나 이용 기간이 하루 이틀 어긋나는 결제일).
export const COVERAGE_SLACK_DAYS = 3;

// 두 달에 거래가 있는 카드 중 지난달 1일 또는 선택한 달 말일까지 내역이 닿지 않는 카드가 있으면 그 달을 돌려준다.
function findPartialMonth(transactions: Transaction[], month: YearMonth): YearMonth | null {
  const previousMonth = addMonths(month, -1);
  const ranges = new Map<string, { from: IsoDate; to: IsoDate; active: boolean }>();
  for (const { cardId, date } of transactions) {
    const range = ranges.get(cardId) ?? { from: date, to: date, active: false };
    if (date < range.from) range.from = date;
    if (date > range.to) range.to = date;
    if (monthOf(date) === month || monthOf(date) === previousMonth) range.active = true;
    ranges.set(cardId, range);
  }

  const active = [...ranges.values()].filter((range) => range.active);
  const start = `${previousMonth}-01`;
  const end = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  if (active.some(({ from }) => daysBetween(start, from) > COVERAGE_SLACK_DAYS)) return previousMonth;
  if (active.some(({ to }) => daysBetween(to, end) > COVERAGE_SLACK_DAYS)) return month;
  return null;
}

export type MonthComparison = {
  mom: MonthOverMonth | null;
  partialMonth: YearMonth | null; // 내역이 일부만 있어 비교하지 않은 달
};

export function buildMonthComparison(
  transactions: Transaction[],
  month: YearMonth,
  today: IsoDate,
): MonthComparison {
  if (month >= monthOf(today)) return { mom: null, partialMonth: null };

  const previousMonth = addMonths(month, -1);
  const previous = snapshotForMonth(transactions, previousMonth, today);
  if (previous === null) return { mom: null, partialMonth: null };

  const partialMonth = findPartialMonth(transactions, month);
  if (partialMonth !== null) return { mom: null, partialMonth };

  const current = snapshotForMonth(transactions, month, today);
  return {
    mom: {
      previousMonth,
      previousTotal: previous.total,
      diff: (current?.total ?? 0) - previous.total,
    },
    partialMonth: null,
  };
}

export function buildMonthOverMonth(
  transactions: Transaction[],
  month: YearMonth,
  today: IsoDate,
): MonthOverMonth | null {
  return buildMonthComparison(transactions, month, today).mom;
}

export function buildCategoryChanges(
  current: Pick<PeriodSnapshot, "categories"> | undefined,
  previous: Pick<PeriodSnapshot, "categories"> | undefined,
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
  const currentMonth = new Date().toISOString().slice(0, 7);
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
