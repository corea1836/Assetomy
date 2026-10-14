import type { Transaction } from "@/types/transaction";

type CancellationGroup = {
  payments: Transaction[];
  cancellations: Transaction[];
};

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareTransactions(a: Transaction, b: Transaction): number {
  return compareStrings(a.date, b.date) || compareStrings(a.id, b.id);
}

function groupKey(transaction: Transaction, amount: number): string {
  return JSON.stringify([transaction.cardId, transaction.merchantKey, amount]);
}

// 같은 카드·같은 정규화 가맹점에서 금액이 정확히 반대인 취소와 결제를 짝짓는다(ADR-025).
// 짝지은 거래(결제·취소 모두)의 id를 돌려준다.
export function pairCancellations(transactions: Transaction[]): Set<string> {
  const groups = new Map<string, CancellationGroup>();

  for (const transaction of transactions) {
    if (transaction.amount === 0) continue;

    const amount = Math.abs(transaction.amount);
    const key = groupKey(transaction, amount);
    let group = groups.get(key);
    if (!group) {
      group = { payments: [], cancellations: [] };
      groups.set(key, group);
    }

    if (transaction.amount > 0) group.payments.push(transaction);
    else group.cancellations.push(transaction);
  }

  const paired = new Set<string>();
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => compareStrings(a, b));
  for (const [, { payments, cancellations }] of orderedGroups) {
    payments.sort(compareTransactions);
    cancellations.sort(compareTransactions);

    const available: Transaction[] = [];
    let nextPayment = 0;
    for (const cancellation of cancellations) {
      while (
        nextPayment < payments.length
        && payments[nextPayment].date <= cancellation.date
      ) {
        available.push(payments[nextPayment]);
        nextPayment += 1;
      }

      const payment = available.pop();
      if (!payment) continue;
      paired.add(payment.id);
      paired.add(cancellation.id);
    }
  }

  return paired;
}
