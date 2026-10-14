import type { Finding, FindingSummary } from "@/types/dashboard";
import type { Transaction, YearMonth } from "@/types/transaction";
import { pairCancellations } from "./cancellations";
import { daysBetween, monthOf } from "./dates";

export const RECURRING_MIN_GAP_DAYS = 28;
export const RECURRING_MAX_GAP_DAYS = 35;
export const RECURRING_AMOUNT_TOLERANCE = 0.1;
export const DUPLICATE_MIN_AMOUNT = 10_000;
export const LARGE_MIN_SAMPLE = 20;
export const LARGE_MEDIAN_MULTIPLIER = 10;

const MIN_GROUP_SIZE = 2;
const FINDING_KIND_ORDER = { recurring: 0, duplicate: 1, large: 2 };

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareTransactions(a: Transaction, b: Transaction): number {
  return compareStrings(a.date, b.date) || compareStrings(a.id, b.id);
}

function compareFindings(a: Finding, b: Finding): number {
  return b.amount - a.amount
    || compareStrings(a.merchantKey, b.merchantKey)
    || compareStrings(a.transactions[0].date, b.transactions[0].date)
    || compareStrings(a.transactions[0].id, b.transactions[0].id);
}

function findingDetails(transactions: Transaction[]) {
  const ordered = [...transactions].sort(compareTransactions);
  // snapshot과 같이 동일 날짜는 가장 큰 id의 표시값을 쓴다.
  const latest = ordered[ordered.length - 1];
  return {
    merchantKey: latest.merchantKey,
    merchant: latest.merchant,
    category: latest.category,
    amount: ordered.reduce((sum, transaction) => sum + transaction.amount, 0),
    transactions: ordered.map(({ id, date, amount, cardLabel }) => ({
      id, date, amount, cardLabel,
    })),
  };
}

function isRecurringPair(previous: Transaction, current: Transaction): boolean {
  const gap = daysBetween(previous.date, current.date);
  return gap >= RECURRING_MIN_GAP_DAYS
    && gap <= RECURRING_MAX_GAP_DAYS
    && Math.abs(current.amount - previous.amount)
      <= previous.amount * RECURRING_AMOUNT_TOLERANCE;
}

function appendRecurringFinding(
  series: Transaction[],
  month: YearMonth,
  findings: Finding[],
): void {
  if (series.length < MIN_GROUP_SIZE) return;
  const monthly = series.filter((transaction) => monthOf(transaction.date) === month);
  if (monthly.length === 0) return;

  findings.push({
    kind: "recurring",
    ...findingDetails(monthly),
    seriesMonths: series.map((transaction) => monthOf(transaction.date)),
  });
}

export function detectRecurring(
  transactions: Transaction[],
  month: YearMonth,
): Finding[] {
  const merchants = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    if (transaction.amount <= 0) continue;
    const group = merchants.get(transaction.merchantKey);
    if (group) group.push(transaction);
    else merchants.set(transaction.merchantKey, [transaction]);
  }

  const findings: Finding[] = [];
  for (const payments of merchants.values()) {
    const monthCounts = new Map<YearMonth, number>();
    for (const payment of payments) {
      const paymentMonth = monthOf(payment.date);
      monthCounts.set(paymentMonth, (monthCounts.get(paymentMonth) ?? 0) + 1);
    }
    const eligible = payments.filter(
      (payment) => monthCounts.get(monthOf(payment.date))! < MIN_GROUP_SIZE,
    ).sort(compareTransactions);

    let series: Transaction[] = [];
    for (const payment of eligible) {
      const previous = series[series.length - 1];
      if (previous && !isRecurringPair(previous, payment)) {
        appendRecurringFinding(series, month, findings);
        series = [];
      }
      series.push(payment);
    }
    appendRecurringFinding(series, month, findings);
  }

  return findings.sort(compareFindings);
}

function cancellationKey(transaction: Transaction, amount: number): string {
  return JSON.stringify([transaction.cardId, transaction.merchantKey, amount]);
}

export function detectDuplicates(
  transactions: Transaction[],
  month: YearMonth,
): Finding[] {
  const groups = new Map<string, Transaction[]>();
  const cancellationCounts = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.amount < 0) {
      const key = cancellationKey(transaction, -transaction.amount);
      cancellationCounts.set(key, (cancellationCounts.get(key) ?? 0) + 1);
    } else if (
      monthOf(transaction.date) === month
      && transaction.amount >= DUPLICATE_MIN_AMOUNT
      && transaction.category !== "transport"
    ) {
      const key = JSON.stringify([
        transaction.cardId, transaction.date, transaction.merchantKey, transaction.amount,
      ]);
      const group = groups.get(key);
      if (group) group.push(transaction);
      else groups.set(key, [transaction]);
    }
  }

  const findings: Finding[] = [];
  for (const group of groups.values()) {
    const payment = group[0];
    const cancellations = cancellationCounts.get(cancellationKey(payment, payment.amount)) ?? 0;
    if (group.length - cancellations < MIN_GROUP_SIZE) continue;
    findings.push({ kind: "duplicate", ...findingDetails(group) });
  }

  return findings.sort(compareFindings);
}

export function detectLarge(
  transactions: Transaction[],
  month: YearMonth,
): Finding[] {
  const pairedCancellations = pairCancellations(transactions);
  const positive = transactions.filter(
    (transaction) => transaction.amount > 0 && !pairedCancellations.has(transaction.id),
  );
  if (positive.length < LARGE_MIN_SAMPLE) return [];

  const amounts = positive.map((transaction) => transaction.amount).sort((a, b) => a - b);
  const middle = Math.floor(amounts.length / 2);
  const median = amounts.length % 2 === 0
    ? (amounts[middle - 1] + amounts[middle]) / 2
    : amounts[middle];
  const threshold = median * LARGE_MEDIAN_MULTIPLIER;

  return positive
    .filter((transaction) => monthOf(transaction.date) === month && transaction.amount > threshold)
    .map((transaction): Finding => ({ kind: "large", ...findingDetails([transaction]) }))
    .sort(compareFindings);
}

export function detectFindings(
  transactions: Transaction[],
  month: YearMonth,
): Finding[] {
  return [
    ...detectRecurring(transactions, month),
    ...detectDuplicates(transactions, month),
    ...detectLarge(transactions, month),
  ].sort((a, b) => FINDING_KIND_ORDER[a.kind] - FINDING_KIND_ORDER[b.kind] || compareFindings(a, b));
}

export function summarizeFindings(findings: Finding[]): FindingSummary {
  const byKind: FindingSummary["byKind"] = {
    recurring: { count: 0, amount: 0 },
    duplicate: { count: 0, amount: 0 },
    large: { count: 0, amount: 0 },
  };
  const seen = new Set<string>();
  let candidateTotal = 0;
  for (const finding of findings) {
    byKind[finding.kind].count += 1;
    byKind[finding.kind].amount += finding.amount;
    for (const transaction of finding.transactions) {
      if (seen.has(transaction.id)) continue;
      seen.add(transaction.id);
      candidateTotal += transaction.amount;
    }
  }

  return { byKind, candidateTotal };
}
