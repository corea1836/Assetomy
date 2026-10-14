import "server-only";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCardDashboard } from "@/lib/analytics/dashboard";
import type { StatementRecord } from "@/types/card";
import type { CardDashboard, Plan } from "@/types/dashboard";
import type { SaveCardSummaryInput, StoredSummary } from "@/types/summary";
import type { SummaryFeedback } from "@/types/summary";
import type { Transaction } from "@/types/transaction";
import { QueryError } from "@/lib/queries/query-error";
import { StoreError } from "@/lib/store/store-error";
import type { CardSummarizer, SummaryResult } from "@/services/llm/types";
import { prepareCardSummary, resolveCardSummary, type CardSummaryDeps, type PreparedCardSummary } from "./card-summary";

const userId = "user-a";
const cardLabel = "생활비 카드 비공개 라벨";
const storedText = "지난 카드 요약 문장";
const generatedText = "이번 카드의 식비 지출을 살펴봐요.";
const generatedTips = ["식비 예산을 정하고 다음 기간 지출 흐름을 살펴보세요."];
const tipCategories = ["food"] as const;

function card(basis: "month" | "cycle" = "month") {
  return {
    id: "card-a", label: cardLabel, issuer: "hyundai" as const,
    analysisBasis: basis, cycleStartDay: basis === "cycle" ? 12 : null,
  };
}

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-a", cardId: "card-a", cardLabel, statementDate: null, date: "2026-09-15",
    merchant: "예시 가맹점", merchantKey: "example", amount: 12_000, category: "food", ...overrides,
  };
}

function dashboard(plan: Plan = "free", basis: "month" | "cycle" = "month"): CardDashboard {
  const cardTransactions = basis === "month"
    ? [
      transaction({ id: "tx-aug", date: "2026-08-01", amount: 10_000 }),
      transaction({ id: "tx-sep", date: "2026-09-30", amount: 12_000 }),
    ]
    : [
      transaction({ id: "tx-prev", date: "2026-09-05", statementDate: "2026-09-23", amount: 15_000 }),
      transaction({ id: "tx-current", date: "2026-10-05", statementDate: "2026-10-23", amount: 20_000 }),
    ];
  const statements: StatementRecord[] = basis === "cycle"
    ? [
      { cardId: "card-a", statementDate: "2026-09-23", savedOn: "2026-09-12" },
      { cardId: "card-a", statementDate: "2026-10-23", savedOn: "2026-10-12" },
    ]
    : [];
  const result = buildCardDashboard({
    card: card(basis), transactions: cardTransactions, statements, plan,
    month: "2026-09", statement: "2026-10-23", today: "2026-10-14",
  });
  if (result === null) throw new Error("Expected card dashboard DTO");
  return result;
}

function makeSummarizer(overrides: Partial<CardSummarizer> = {}): CardSummarizer {
  return {
    modelFor: vi.fn((plan) => plan === "free" ? "claude-sonnet-5-5" : "claude-opus-5-5"),
    promptFor: vi.fn((plan) => `${plan} card prompt`),
    summarize: vi.fn(async (): Promise<SummaryResult> => ({ ok: true, summary: generatedText, tips: generatedTips, tipCategories: [...tipCategories] })),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<CardSummaryDeps> = {}) {
  const summarizer = makeSummarizer();
  const deps: CardSummaryDeps = {
    loadStored: vi.fn(async () => null), summarizer,
    save: vi.fn(async () => ({ kind: "saved" as const })), ...overrides,
  };
  return { deps, summarizer };
}

function prepared(
  plan: Plan = "free",
  basis: "month" | "cycle" = "month",
  summarizer = makeSummarizer(),
  feedback: SummaryFeedback = {},
): PreparedCardSummary {
  return prepareCardSummary(dashboard(plan, basis), summarizer, feedback);
}

describe("prepareCardSummary", () => {
  it("builds only from the dashboard DTO and hashes model, prompt, and card summary input", () => {
    const dto = dashboard("pro");
    const summarizer = makeSummarizer();
    const result = prepareCardSummary(dto, summarizer, {});
    expect(result).toMatchObject({ cardId: "card-a", period: "2026-09", plan: "pro", model: "claude-opus-5-5" });
    expect(result.input).not.toHaveProperty("card");
    expect(JSON.stringify(result.input)).not.toContain(cardLabel);
    expect(summarizer.modelFor).toHaveBeenCalledExactlyOnceWith("pro");
    expect(summarizer.promptFor).toHaveBeenCalledExactlyOnceWith("pro");
    expect(result.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses month and statement date as separate storage period keys", () => {
    expect(prepared("free", "month").period).toBe("2026-09");
    expect(prepared("free", "cycle").period).toBe("2026-10-23");
  });

  it("changes the input hash when only the prompt or model changes", () => {
    const dto = dashboard();
    expect(prepareCardSummary(dto, makeSummarizer({ promptFor: () => "prompt A" }), {}).inputHash)
      .not.toBe(prepareCardSummary(dto, makeSummarizer({ promptFor: () => "prompt B" }), {}).inputHash);
    expect(prepareCardSummary(dto, makeSummarizer({ modelFor: () => "mock" }), {}).inputHash)
      .not.toBe(prepareCardSummary(dto, makeSummarizer({ modelFor: () => "claude-sonnet-5-5" }), {}).inputHash);
  });

  it("changes the input hash when the card summary input changes", () => {
    const original = prepareCardSummary(dashboard(), makeSummarizer(), {});
    const changedTransactions = [
      transaction({ id: "tx-aug", date: "2026-08-01", amount: 10_000 }),
      transaction({ id: "tx-sep", date: "2026-09-30", amount: 13_000 }),
    ];
    const changedDashboard = buildCardDashboard({
      card: card(), transactions: changedTransactions, statements: [], plan: "free",
      month: "2026-09", today: "2026-10-14",
    });
    if (changedDashboard === null) throw new Error("Expected card dashboard DTO");
    expect(prepareCardSummary(changedDashboard, makeSummarizer(), {}).inputHash).not.toBe(original.inputHash);
  });

  it("changes its input hash when category feedback changes", () => {
    const dto = dashboard();
    const summarizer = makeSummarizer();
    const first = prepareCardSummary(dto, summarizer, { food: "평일 점심이에요" });
    expect(prepareCardSummary(dto, summarizer, { food: "평일 점심이에요" }).inputHash).toBe(first.inputHash);
    expect(prepareCardSummary(dto, summarizer, { food: "출장 중이에요" }).inputHash).not.toBe(first.inputHash);
  });
});

describe("resolveCardSummary", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));

  it("fails on a stored-row read error without generating", async () => {
    const { deps, summarizer } = makeDeps({
      loadStored: vi.fn().mockRejectedValue(new QueryError("getStoredCardSummary", "PGRST205")),
    });
    expect(await resolveCardSummary(userId, prepared(), deps)).toEqual({ kind: "failed" });
    expect(summarizer.summarize).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("summary:card:load:PGRST205", userId);
  });

  it("returns a matching stored summary without generating or saving", async () => {
    const prep = prepared();
    const { deps, summarizer } = makeDeps({
      loadStored: vi.fn(async () => ({ inputHash: prep.inputHash, summary: storedText, tips: ["저장된 팁"], tipCategories: [...tipCategories] } satisfies StoredSummary)),
    });
    expect(await resolveCardSummary(userId, prep, deps)).toEqual({ kind: "ready", summary: storedText, tips: ["저장된 팁"], tipCategories: [...tipCategories] });
    expect(summarizer.summarize).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("fails on generation failure without exposing a stale saved summary", async () => {
    const prep = prepared();
    const { deps, summarizer } = makeDeps({
      loadStored: vi.fn(async () => ({ inputHash: "f".repeat(64), summary: storedText, tips: ["저장된 팁"], tipCategories: [...tipCategories] })),
    });
    vi.mocked(summarizer.summarize).mockResolvedValue({ ok: false, reason: "number" });
    expect(await resolveCardSummary(userId, prep, deps)).toEqual({ kind: "failed" });
    expect(summarizer.summarize).toHaveBeenCalledExactlyOnceWith(prep.input);
    expect(deps.save).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("summary:card:generate:number", userId);
  });

  it("saves generated content using the card and period key", async () => {
    const prep = prepared("pro", "cycle");
    const { deps, summarizer } = makeDeps();
    expect(await resolveCardSummary(userId, prep, deps)).toEqual({ kind: "ready", summary: generatedText, tips: generatedTips, tipCategories: [...tipCategories] });
    expect(summarizer.summarize).toHaveBeenCalledExactlyOnceWith(prep.input);
    expect(deps.save).toHaveBeenCalledExactlyOnceWith({
      userId, cardId: prep.cardId, period: prep.period, plan: prep.plan, model: prep.model,
      inputHash: prep.inputHash, summary: generatedText, tips: generatedTips, tipCategories: [...tipCategories],
    } satisfies SaveCardSummaryInput);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(["card_not_found", "basis_mismatch", "no_data"] as const)(
    "fails and logs the save result %s", async (kind) => {
      const { deps } = makeDeps({ save: vi.fn(async () => ({ kind })) });
      expect(await resolveCardSummary(userId, prepared(), deps)).toEqual({ kind: "failed" });
      expect(console.error).toHaveBeenCalledExactlyOnceWith(`summary:card:save:${kind}`, userId);
    },
  );

  it("returns verified content when saving throws and logs only the store code", async () => {
    const { deps } = makeDeps({
      save: vi.fn().mockRejectedValue(new StoreError("save_card_summary", "PGRST202")),
    });
    expect(await resolveCardSummary(userId, prepared(), deps)).toEqual({ kind: "ready", summary: generatedText, tips: generatedTips, tipCategories: [...tipCategories] });
    expect(console.error).toHaveBeenCalledExactlyOnceWith("summary:card:save:PGRST202", userId);
  });

  it("catches a summarizer that unexpectedly throws", async () => {
    const summarizer = makeSummarizer({ summarize: vi.fn().mockRejectedValue(new Error("private-value")) });
    const { deps } = makeDeps({ summarizer });
    expect(await resolveCardSummary(userId, prepared(), deps)).toEqual({ kind: "failed" });
    expect(deps.save).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("summary:card:generate:unexpected_error", userId);
  });

  it("keeps card labels and summary content out of logs", async () => {
    const { deps } = makeDeps({
      loadStored: vi.fn().mockRejectedValue(new Error(`${generatedText} ${cardLabel}`)),
    });
    await resolveCardSummary(userId, prepared(), deps);
    expect(console.error).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("summary:card:load:unexpected_error", userId);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(cardLabel);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(generatedText);
  });
});
