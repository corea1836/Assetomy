import type { CardDashboard, Dashboard, PeriodSnapshot, Plan } from "@/types/dashboard";
import type { StatementRecord } from "@/types/card";
import type { IsoDate, Transaction } from "@/types/transaction";
import type { CardOption } from "@/types/upload";
import { buildCategoryChanges, buildMonthComparison, buildTrend } from "./comparison";
import { detectFindings, summarizeFindings } from "./detection";
import { addMonths, datesBetween, monthOf } from "./dates";
import { statementCyclePeriod } from "./statements";
import { buildPeriodSnapshot, buildSnapshot, listDataMonths } from "./snapshot";

export type BuildDashboardInput = {
  transactions: Transaction[];
  plan: Plan;
  month?: string;
  today: IsoDate;
};

export function buildDashboard(input: BuildDashboardInput): Dashboard | null {
  const { transactions, plan, month: requestedMonth, today } = input;
  if (transactions.length === 0) return null;

  const months = listDataMonths(transactions);
  const month = months.find((option) => option.month === requestedMonth)?.month
    ?? months[0].month;
  const common = {
    month,
    months,
    lastDate: months[0].period.to,
    snapshot: buildSnapshot(transactions, month, today),
    ...buildMonthComparison(transactions, month, today),
  };
  const items = detectFindings(transactions, month);
  const { byKind, candidateTotal } = summarizeFindings(items);
  const trend = buildTrend(transactions, month, today);

  if (plan === "free") {
    // RSC payload에 탐지 상세나 추세가 섞이지 않도록 허용된 필드만 만든다.
    return {
      ...common,
      plan: "free",
      teaser: { byKind, candidateTotal },
      trendAvailable: trend !== null,
    };
  }

  return {
    ...common,
    plan: "pro",
    findings: { byKind, candidateTotal, items },
    trend,
  };
}

export type BuildCardDashboardInput = {
  card: CardOption;
  transactions: Transaction[];
  statements: StatementRecord[];
  plan: Plan;
  month?: string;
  statement?: string;
  today: IsoDate;
};

function statementIsComplete(
  cardId: string,
  statementDate: IsoDate,
  cycleStartDay: number,
  statements: StatementRecord[],
): boolean {
  const record = statements.find(
    (item) => item.cardId === cardId && item.statementDate === statementDate,
  );
  return record !== undefined
    && record.savedOn > statementCyclePeriod(statementDate, cycleStartDay).to;
}

export function buildCardDashboard(input: BuildCardDashboardInput): CardDashboard | null {
  const { card, transactions, statements, plan, today } = input;
  const cardTransactions = transactions.filter(({ cardId }) => cardId === card.id);

  if (card.analysisBasis === "month") {
    if (cardTransactions.length === 0) return null;

    const months = listDataMonths(cardTransactions);
    const month = months.find(({ month: optionMonth }) => optionMonth === input.month)?.month
      ?? months[0].month;
    const snapshot = buildSnapshot(cardTransactions, month, today);
    const { mom, partialMonth } = buildMonthComparison(cardTransactions, month, today);
    const common = {
      card,
      basis: "month" as const,
      month,
      months,
      lastDate: months[0].period.to,
      snapshot,
      mom,
      partialMonth,
    };

    if (plan === "free") return { ...common, plan: "free" };

    const previousSnapshot = mom === null
      ? undefined
      : buildSnapshot(cardTransactions, mom.previousMonth, today);
    return {
      ...common,
      plan: "pro",
      categoryChanges: mom === null
        ? null
        : buildCategoryChanges(snapshot, previousSnapshot),
    };
  }

  const cycleStartDay = card.cycleStartDay;
  if (cycleStartDay === null) {
    throw new Error("Cycle card is missing its cycle start day");
  }

  const statementTransactions = cardTransactions.filter(
    (transaction): transaction is Transaction & { statementDate: IsoDate } =>
      transaction.statementDate !== null,
  );
  if (statementTransactions.length === 0) return null;

  const statementDates = [...new Set(
    statementTransactions.map((transaction) => transaction.statementDate),
  )].sort((a, b) => a < b ? 1 : a > b ? -1 : 0);
  const statementDate = input.statement !== undefined
    && statementDates.includes(input.statement)
    ? input.statement
    : statementDates[0];
  const statementOptions = statementDates.map((date) => ({
    statementDate: date,
    cyclePeriod: statementCyclePeriod(date, cycleStartDay),
  }));
  const cyclePeriod = statementCyclePeriod(statementDate, cycleStartDay);
  const complete = statementIsComplete(card.id, statementDate, cycleStartDay, statements);
  const selectedTransactions = statementTransactions.filter(
    (transaction) => transaction.statementDate === statementDate,
  );
  let dailyFrom = cyclePeriod.from;
  let dailyTo = cyclePeriod.to;
  for (const transaction of selectedTransactions) {
    if (transaction.date < dailyFrom) dailyFrom = transaction.date;
    if (transaction.date > dailyTo) dailyTo = transaction.date;
  }
  const snapshot = buildPeriodSnapshot(selectedTransactions, datesBetween(dailyFrom, dailyTo));
  const previousMonth = addMonths(monthOf(statementDate), -1);
  const previousStatementDate = statementDates
    .filter((date) => monthOf(date) === previousMonth)
    .sort()
    .at(-1);

  let comparison: {
    previousStatementDate: IsoDate;
    previousTotal: number;
    diff: number;
  } | null = null;
  let comparisonSkipped = false;
  let previousSnapshot: PeriodSnapshot | undefined;

  if (previousStatementDate !== undefined) {
    const previousComplete = statementIsComplete(
      card.id,
      previousStatementDate,
      cycleStartDay,
      statements,
    );
    if (complete && previousComplete) {
      const previousTransactions = statementTransactions.filter(
        (transaction) => transaction.statementDate === previousStatementDate,
      );
      previousSnapshot = buildPeriodSnapshot(previousTransactions, []);
      comparison = {
        previousStatementDate,
        previousTotal: previousSnapshot.total,
        diff: snapshot.total - previousSnapshot.total,
      };
    } else {
      comparisonSkipped = true;
    }
  }

  const common = {
    card,
    basis: "cycle" as const,
    statementDate,
    statements: statementOptions,
    cyclePeriod,
    complete,
    snapshot,
    comparison,
    comparisonSkipped,
  };

  if (plan === "free") return { ...common, plan: "free" };

  return {
    ...common,
    plan: "pro",
    categoryChanges: comparison === null
      ? null
      : buildCategoryChanges(snapshot, previousSnapshot),
  };
}
