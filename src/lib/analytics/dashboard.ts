import type {
  CardDashboard, CardFlow, CategoryFlow, Dashboard, FlowPeriod, PeriodSnapshot, Plan,
} from "@/types/dashboard";
import type { StatementRecord } from "@/types/card";
import type { IsoDate, Transaction } from "@/types/transaction";
import type { CardOption } from "@/types/upload";
import { buildCategoryChanges, buildMonthComparison, buildTrend } from "./comparison";
import { detectFindings, summarizeFindings } from "./detection";
import { addMonths, datesBetween, monthOf } from "./dates";
import { statementCyclePeriod } from "./statements";
import { buildPeriodSnapshot, buildSnapshot, listDataMonths } from "./snapshot";
import { FLOW_CATEGORY_LIMIT, flowDirection } from "./flow";

function categoryFlows(
  current: PeriodSnapshot,
  snapshots: PeriodSnapshot[],
): CategoryFlow[] {
  return current.categories
    .filter(({ category, amount }) => category !== "etc" && amount > 0)
    .slice(0, FLOW_CATEGORY_LIMIT)
    .map(({ category }) => {
      const amounts = snapshots.map((snapshot) =>
        snapshot.categories.find((item) => item.category === category)?.amount ?? 0,
      );
      return { category, amounts, direction: flowDirection(amounts) };
    });
}

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
    const earlierComparison = mom === null
      ? null
      : buildMonthComparison(cardTransactions, mom.previousMonth, today).mom;
    const flowMonths = mom === null || earlierComparison === null
      ? null
      : [earlierComparison.previousMonth, mom.previousMonth, month] as const;
    const flowSnapshots = flowMonths === null
      ? null
      : flowMonths.map((flowMonth) => buildSnapshot(cardTransactions, flowMonth, today));
    const flow: CardFlow | null = flowMonths === null || flowSnapshots === null
      ? null
      : {
        periods: flowMonths.map((flowMonth, index): FlowPeriod => ({
          month: flowMonth,
          total: flowSnapshots[index].total,
        })),
        direction: flowDirection(flowSnapshots.map(({ total }) => total)),
      };
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

    if (plan === "free") return { ...common, plan: "free", flow };

    const previousSnapshot = mom === null
      ? undefined
      : buildSnapshot(cardTransactions, mom.previousMonth, today);
    return {
      ...common,
      plan: "pro",
      flow: flow === null || flowSnapshots === null
        ? null
        : { ...flow, categories: categoryFlows(flowSnapshots[2], flowSnapshots) },
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
  const previousMonth = addMonths(statementDate.slice(0, 7), -1);
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

  let statementFlow: CardFlow | null = null;
  let statementFlowSnapshots: PeriodSnapshot[] | null = null;
  if (comparison !== null && previousSnapshot !== undefined && previousStatementDate !== undefined) {
    const olderPaymentMonth = addMonths(monthOf(previousStatementDate), -1);
    const olderStatementDate = statementDates
      .filter((date) => monthOf(date) === olderPaymentMonth)
      .sort()
      .at(-1);
    if (olderStatementDate !== undefined && statementIsComplete(
      card.id,
      olderStatementDate,
      cycleStartDay,
      statements,
    )) {
      const olderTransactions = statementTransactions.filter(
        (transaction) => transaction.statementDate === olderStatementDate,
      );
      const olderSnapshot = buildPeriodSnapshot(olderTransactions, []);
      const currentFlowSnapshot = buildPeriodSnapshot(selectedTransactions, []);
      const flowSnapshots = [olderSnapshot, previousSnapshot, currentFlowSnapshot];
      statementFlowSnapshots = flowSnapshots;
      const flowMonths = [
        monthOf(olderStatementDate),
        monthOf(previousStatementDate),
        monthOf(statementDate),
      ] as const;
      statementFlow = {
        periods: flowMonths.map((flowMonth, index): FlowPeriod => ({
          month: flowMonth,
          total: flowSnapshots[index].total,
        })),
        direction: flowDirection(flowSnapshots.map(({ total }) => total)),
      };
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

  if (plan === "free") return { ...common, plan: "free", flow: statementFlow };

  return {
    ...common,
    plan: "pro",
    flow: statementFlow === null || statementFlowSnapshots === null
      ? null
      : { ...statementFlow, categories: categoryFlows(statementFlowSnapshots[2], statementFlowSnapshots) },
    categoryChanges: comparison === null
      ? null
      : buildCategoryChanges(snapshot, previousSnapshot),
  };
}
