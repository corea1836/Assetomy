import { describe, expect, it } from "vitest";
import type { Transaction } from "@/types/transaction";
import { pairCancellations } from "./cancellations";

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-default",
    cardId: "card-a",
    cardLabel: "생활비 카드",
    statementDate: null,
    date: "2026-10-05",
    merchant: "교육 가맹점",
    merchantKey: "education",
    amount: 254_000,
    category: "education",
    ...overrides,
  };
}

describe("pairCancellations", () => {
  it("pairs the same-day cancellation with its prior payment and leaves the later amount unmatched", () => {
    expect(pairCancellations([
      transaction({ id: "payment-254", amount: 254_000 }),
      transaction({ id: "cancel-254", amount: -254_000 }),
      transaction({ id: "payment-284", date: "2026-10-09", amount: 284_000 }),
    ])).toEqual(new Set(["payment-254", "cancel-254"]));
  });

  it("does not pair a cancellation dated before its same-amount payment", () => {
    expect(pairCancellations([
      transaction({ id: "cancel", date: "2026-10-03", amount: -254_000 }),
      transaction({ id: "payment", date: "2026-10-05", amount: 254_000 }),
    ])).toEqual(new Set());
  });

  it("pairs each cancellation with the latest eligible unmatched payment", () => {
    expect(pairCancellations([
      transaction({ id: "payment-early", date: "2026-10-01" }),
      transaction({ id: "payment-late", date: "2026-10-04" }),
      transaction({ id: "cancel", date: "2026-10-06", amount: -254_000 }),
    ])).toEqual(new Set(["payment-late", "cancel"]));
  });

  it("uses the greater id when same-day payments are tied", () => {
    expect(pairCancellations([
      transaction({ id: "payment-a" }),
      transaction({ id: "payment-z" }),
      transaction({ id: "cancel", amount: -254_000 }),
    ])).toEqual(new Set(["payment-z", "cancel"]));
  });

  it("requires the same card and normalized merchant", () => {
    expect(pairCancellations([
      transaction({ id: "payment-a" }),
      transaction({ id: "cancel-other-card", cardId: "card-b", amount: -254_000 }),
      transaction({ id: "cancel-other-merchant", merchantKey: "different", amount: -254_000 }),
    ])).toEqual(new Set());
  });

  it("does not pair a partial cancellation", () => {
    expect(pairCancellations([
      transaction({ id: "payment", amount: 30_000 }),
      transaction({ id: "partial-cancel", amount: -10_000 }),
    ])).toEqual(new Set());
  });

  it("pairs cancellations one by one, leaving excess cancellations unmatched", () => {
    const twoPaymentsAndTwoCancellations = pairCancellations([
      transaction({ id: "payment-a" }),
      transaction({ id: "payment-b", date: "2026-10-06" }),
      transaction({ id: "cancel-a", date: "2026-10-07", amount: -254_000 }),
      transaction({ id: "cancel-b", date: "2026-10-08", amount: -254_000 }),
    ]);
    expect(twoPaymentsAndTwoCancellations).toEqual(new Set([
      "payment-a", "payment-b", "cancel-a", "cancel-b",
    ]));

    expect(pairCancellations([
      transaction({ id: "payment" }),
      transaction({ id: "cancel-early", date: "2026-10-06", amount: -254_000 }),
      transaction({ id: "cancel-late", date: "2026-10-07", amount: -254_000 }),
    ])).toEqual(new Set(["payment", "cancel-early"]));
  });

  it("is independent of input order and does not mutate the input", () => {
    const transactions = [
      transaction({ id: "payment-early", date: "2026-10-01" }),
      transaction({ id: "payment-late", date: "2026-10-04" }),
      transaction({ id: "cancel-a", date: "2026-10-06", amount: -254_000 }),
      transaction({ id: "cancel-b", date: "2026-10-07", amount: -254_000 }),
    ];
    const original = structuredClone(transactions);
    const result = pairCancellations(transactions);

    const reversedResult = pairCancellations([...transactions].reverse());
    expect(reversedResult).toEqual(result);
    expect([...reversedResult]).toEqual([...result]);
    expect(transactions).toEqual(original);
  });
});
