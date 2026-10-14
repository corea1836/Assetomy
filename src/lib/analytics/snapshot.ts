import { CATEGORY_IDS, type CategoryId } from "@/types/category";
import type { MonthOption, Period, PeriodSnapshot, Snapshot } from "@/types/dashboard";
import type { IsoDate, Transaction, YearMonth } from "@/types/transaction";
import { datesOfMonth, monthOf } from "./dates";

export const TOP_MERCHANT_LIMIT = 5;

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function extendPeriod(period: Period, date: IsoDate): void {
  if (date < period.from) period.from = date;
  if (date > period.to) period.to = date;
}

export function listDataMonths(transactions: Transaction[]): MonthOption[] {
  const periods = new Map<YearMonth, Period>();

  for (const transaction of transactions) {
    const month = monthOf(transaction.date);
    const period = periods.get(month);
    if (period) {
      extendPeriod(period, transaction.date);
    } else {
      periods.set(month, { from: transaction.date, to: transaction.date });
    }
  }

  return Array.from(periods, ([month, period]) => ({ month, period }))
    .sort((a, b) => compareStrings(b.month, a.month));
}

export function buildSnapshot(
  transactions: Transaction[],
  month: YearMonth,
  today: IsoDate,
): Snapshot {
  const monthlyTransactions = transactions.filter(
    (transaction) => monthOf(transaction.date) === month,
  );
  if (monthlyTransactions.length === 0) {
    throw new Error("Cannot build a snapshot for a month without transactions");
  }

  const periodSnapshot = buildPeriodSnapshot(monthlyTransactions, datesOfMonth(month));
  return {
    month,
    period: periodSnapshot.period,
    total: periodSnapshot.total,
    transactionCount: periodSnapshot.transactionCount,
    inProgress: month >= monthOf(today),
    categories: periodSnapshot.categories,
    topMerchants: periodSnapshot.topMerchants,
    otherMerchants: periodSnapshot.otherMerchants,
    daily: periodSnapshot.daily,
  };
}

export function buildPeriodSnapshot(
  transactions: Transaction[],
  dates: IsoDate[],
): PeriodSnapshot {
  if (transactions.length === 0) {
    throw new Error("Cannot build a snapshot without transactions");
  }

  const firstDate = transactions[0].date;
  const period: Period = { from: firstDate, to: firstDate };
  let total = 0;
  const categoryTotals = new Map<CategoryId, number>();
  const dailyTotals = new Map<IsoDate, number>();
  const merchantTotals = new Map<string, {
    latest: Transaction;
    amount: number;
    count: number;
  }>();

  for (const transaction of transactions) {
    const { date, category, merchantKey, amount } = transaction;
    total += amount;
    extendPeriod(period, date);
    categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + amount);
    dailyTotals.set(date, (dailyTotals.get(date) ?? 0) + amount);

    const merchantTotal = merchantTotals.get(merchantKey);
    if (merchantTotal) {
      merchantTotal.amount += amount;
      merchantTotal.count += 1;
      const { latest } = merchantTotal;
      if (date > latest.date || (date === latest.date && transaction.id > latest.id)) {
        merchantTotal.latest = transaction;
      }
    } else {
      merchantTotals.set(merchantKey, { latest: transaction, amount, count: 1 });
    }
  }

  const categories = CATEGORY_IDS.map((category) => {
    const amount = categoryTotals.get(category) ?? 0;
    return { category, amount, ratio: total > 0 ? amount / total : null };
  })
    .filter((category) => category.amount !== 0)
    .sort((a, b) =>
      b.amount - a.amount || CATEGORY_IDS.indexOf(a.category) - CATEGORY_IDS.indexOf(b.category),
    );

  const merchants = [...merchantTotals.values()]
    .sort((a, b) =>
      b.amount - a.amount || compareStrings(a.latest.merchantKey, b.latest.merchantKey),
    )
    .map(({ latest, amount, count }) => ({
      merchantKey: latest.merchantKey,
      merchant: latest.merchant,
      category: latest.category,
      amount,
      count,
    }));
  const topMerchants = merchants.filter(({ amount }) => amount > 0).slice(0, TOP_MERCHANT_LIMIT);
  const topKeys = new Set(topMerchants.map(({ merchantKey }) => merchantKey));
  const otherMerchants = merchants.filter(({ merchantKey }) => !topKeys.has(merchantKey));

  return {
    period,
    total,
    transactionCount: transactions.length,
    categories,
    topMerchants,
    otherMerchants,
    daily: dates.map((date) => ({
      date,
      amount: dailyTotals.get(date) ?? 0,
    })),
  };
}
