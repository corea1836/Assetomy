import { describe, expect, it } from "vitest";
import { buildDashboard } from "@/lib/analytics/dashboard";
import { monthOf } from "@/lib/analytics/dates";
import { DEMO_SUMMARY, DEMO_TODAY, DEMO_TRANSACTIONS } from "./fixture";

function demoDashboard() {
  const dashboard = buildDashboard({
    transactions: DEMO_TRANSACTIONS,
    plan: "pro",
    today: DEMO_TODAY,
  });
  if (dashboard?.plan !== "pro") throw new Error("Expected a Pro demo dashboard");
  return dashboard;
}

describe("demo fixture", () => {
  it("uses a fixed reference date after the last data month", () => {
    expect(DEMO_TODAY).toBe("2026-10-05");
  });

  it("covers four months with at least fifteen transactions and two labelled cards each", () => {
    const months = ["2026-06", "2026-07", "2026-08", "2026-09"];
    expect([...new Set(DEMO_TRANSACTIONS.map(({ date }) => monthOf(date)))].sort())
      .toEqual(months);

    for (const month of months) {
      const monthly = DEMO_TRANSACTIONS.filter(({ date }) => monthOf(date) === month);
      expect(monthly.length).toBeGreaterThanOrEqual(15);
      expect(new Set(monthly.map(({ cardId }) => cardId)).size).toBe(2);
      expect([...new Set(monthly.map(({ cardLabel }) => cardLabel))].sort())
        .toEqual(["생활비 카드", "온라인 쇼핑 카드"]);
    }
    expect(new Set(DEMO_TRANSACTIONS.map(({ cardId }) => cardId)).size).toBe(2);
  });

  it("has unique transaction ids and safe, nonzero integer amounts", () => {
    expect(new Set(DEMO_TRANSACTIONS.map(({ id }) => id)).size)
      .toBe(DEMO_TRANSACTIONS.length);
    for (const transaction of DEMO_TRANSACTIONS) {
      expect(transaction.id).not.toBe("");
      expect(Number.isSafeInteger(transaction.amount)).toBe(true);
      expect(transaction.amount).not.toBe(0);
    }
  });

  it("keeps all ISO dates within the complete June to September period", () => {
    const dates = DEMO_TRANSACTIONS.map(({ date }) => date).sort();
    expect(dates[0]).toBe("2026-06-01");
    expect(dates.at(-1)).toBe("2026-09-30");
    for (const date of dates) {
      expect(date).toMatch(/^2026-(06|07|08|09)-(0[1-9]|[12][0-9]|30)$/);
      expect(date >= "2026-06-01" && date <= "2026-09-30").toBe(true);
    }
  });

  it("keeps a consistent merchant key for each fictional merchant name", () => {
    const keys = new Map<string, string>();
    for (const { merchant, merchantKey } of DEMO_TRANSACTIONS) {
      expect(merchant).toMatch(/^예시 /);
      expect(merchantKey).not.toBe("");
      if (keys.has(merchant)) expect(merchantKey).toBe(keys.get(merchant));
      else keys.set(merchant, merchantKey);
    }
  });

  it("defaults to September with a comparison and a four-month Pro trend", () => {
    const dashboard = demoDashboard();
    expect(dashboard.month).toBe("2026-09");
    expect(dashboard.months).toHaveLength(4);
    expect(dashboard.mom).not.toBeNull();
    expect(dashboard.trend?.months).toHaveLength(4);
    expect(dashboard.snapshot.inProgress).toBe(false);
  });

  it("varies every month so each comparison shows a change without extra candidates", () => {
    const totals = demoDashboard().trend!.months.map(({ total }) => total);
    expect(new Set(totals).size).toBe(totals.length);

    for (const month of ["2026-06", "2026-07", "2026-08", "2026-09"]) {
      const dashboard = buildDashboard({
        transactions: DEMO_TRANSACTIONS,
        plan: "pro",
        month,
        today: DEMO_TODAY,
      });
      if (dashboard?.plan !== "pro") throw new Error("Expected a Pro demo dashboard");
      if (month !== "2026-06") {
        expect(dashboard.mom?.diff).not.toBe(0);
        expect(dashboard.trend?.categoryChanges?.length).toBeGreaterThan(0);
      }
      if (month !== "2026-09") {
        expect(dashboard.findings.byKind.duplicate.count).toBe(0);
        expect(dashboard.findings.byKind.large.count).toBe(0);
      }
    }
  });

  it("has a September net total between 1.2 and 2.5 million won and diverse categories", () => {
    const { snapshot } = demoDashboard();
    expect(snapshot.total).toBeGreaterThanOrEqual(1_200_000);
    expect(snapshot.total).toBeLessThanOrEqual(2_500_000);
    expect(snapshot.categories.length).toBeGreaterThanOrEqual(7);
  });

  it("includes a September cancellation with a matching earlier purchase", () => {
    const cancellations = DEMO_TRANSACTIONS.filter(
      ({ date, amount }) => monthOf(date) === "2026-09" && amount < 0,
    );
    expect(cancellations.length).toBeGreaterThanOrEqual(1);
    for (const cancellation of cancellations) {
      expect(DEMO_TRANSACTIONS.some((purchase) =>
        purchase.cardId === cancellation.cardId
        && purchase.merchantKey === cancellation.merchantKey
        && purchase.amount === -cancellation.amount
        && purchase.date <= cancellation.date,
      )).toBe(true);
    }
  });

  it("detects at least two recurring merchants paid once in every data month", () => {
    const { findings, months } = demoDashboard();
    expect(findings.byKind.recurring.count).toBeGreaterThanOrEqual(2);
    for (const finding of findings.items) {
      if (finding.kind !== "recurring") continue;
      expect(finding.seriesMonths).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
      const payments = DEMO_TRANSACTIONS.filter(
        ({ merchantKey }) => merchantKey === finding.merchantKey,
      );
      expect(payments).toHaveLength(4);
      for (const { month } of months) {
        expect(payments.filter(({ date }) => monthOf(date) === month)).toHaveLength(1);
      }
      for (const payment of payments) {
        expect(Math.abs(payment.amount - payments[0].amount))
          .toBeLessThanOrEqual(payments[0].amount * 0.05);
      }
    }
  });

  it("detects an uncancelled duplicate pair on the same card and day", () => {
    const { findings } = demoDashboard();
    expect(findings.byKind.duplicate.count).toBeGreaterThanOrEqual(1);
    const duplicate = findings.items.find(({ kind }) => kind === "duplicate")!;
    const payments = DEMO_TRANSACTIONS.filter(
      ({ id }) => duplicate.transactions.some((transaction) => transaction.id === id),
    );
    expect(payments).toHaveLength(2);
    expect(payments[0].category).not.toBe("transport");
    expect(payments[0].amount).toBeGreaterThanOrEqual(10_000);
    expect(new Set(payments.map(({ cardId }) => cardId)).size).toBe(1);
    expect(new Set(payments.map(({ date }) => date)).size).toBe(1);
    expect(new Set(payments.map(({ merchantKey }) => merchantKey)).size).toBe(1);
    expect(new Set(payments.map(({ amount }) => amount)).size).toBe(1);
    expect(DEMO_TRANSACTIONS.some((transaction) =>
      transaction.cardId === payments[0].cardId
      && transaction.merchantKey === payments[0].merchantKey
      && transaction.amount === -payments[0].amount,
    )).toBe(false);
  });

  it("detects a September large payment using the existing analytics rules", () => {
    const { findings } = demoDashboard();
    expect(findings.byKind.large.count).toBeGreaterThanOrEqual(1);
    for (const finding of findings.items.filter(({ kind }) => kind === "large")) {
      expect(finding.transactions.every(({ date }) => monthOf(date) === "2026-09"))
        .toBe(true);
    }
  });

  it("does not label the frequently visited cafe as recurring", () => {
    const cafes = DEMO_TRANSACTIONS.filter(({ category }) => category === "cafe");
    expect(cafes.length).toBeGreaterThan(0);
    const cafeKeys = new Set(cafes.map(({ merchantKey }) => merchantKey));
    for (const { month } of demoDashboard().months) {
      expect(cafes.filter(({ date }) => monthOf(date) === month).length)
        .toBeGreaterThanOrEqual(2);
    }
    expect(demoDashboard().findings.items.some(
      ({ kind, merchantKey }) => kind === "recurring" && cafeKeys.has(merchantKey),
    )).toBe(false);
  });

  it("uses two or three fixed summary sentences without digits or prohibited claims", () => {
    expect(DEMO_SUMMARY).not.toMatch(/[0-9]|절약|낭비|부정 결제|AI가 분석/);
    const sentences = DEMO_SUMMARY.split(".").filter((sentence) => sentence.trim());
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(3);
  });
});
