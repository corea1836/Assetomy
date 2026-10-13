import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDashboard } from "@/lib/analytics/dashboard";
import type { Dashboard } from "@/types/dashboard";
import type { SaveSummaryInput, StoredSummary } from "@/types/summary";
import type { Transaction } from "@/types/transaction";
import { QueryError } from "@/lib/queries/query-error";
import { StoreError } from "@/lib/store/store-error";
import type { MonthlySummarizer, SummaryResult } from "@/services/llm/types";
import { buildSummaryInput } from "@/lib/analytics/summary-input";
import { prepareSummary, resolveMonthlySummary, type PreparedSummary, type SummaryDeps } from "./monthly-summary";

const userId = "user-a";
const storedText = "지난 요약 문장";
const generatedText = "이번 달에는 식비 비중이 커졌어요.";

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-a", cardId: "card-a", cardLabel: "생활비 카드", date: "2026-09-15",
    merchant: "예시 가맹점", merchantKey: "example", amount: 12_000, category: "food", ...overrides,
  };
}

const transactions = [
  transaction({ id: "tx-aug", date: "2026-08-15", amount: 10_000 }),
  transaction({ id: "tx-sep", date: "2026-09-15", amount: 12_000 }),
];

function dashboard(plan: "free" | "pro" = "free", items = transactions): Dashboard {
  const result = buildDashboard({ transactions: items, plan, month: "2026-09", today: "2026-10-13" });
  if (!result) throw new Error("Expected dashboard DTO");
  return result;
}

function makeSummarizer(overrides: Partial<MonthlySummarizer> = {}): MonthlySummarizer {
  return {
    modelFor: vi.fn((plan) => plan === "free" ? "claude-sonnet-5-5" : "claude-opus-5-5"),
    summarize: vi.fn(async (): Promise<SummaryResult> => ({ ok: true, text: generatedText })),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SummaryDeps> = {}) {
  const summarizer = makeSummarizer();
  const deps: SummaryDeps = {
    loadStored: vi.fn(async () => null), summarizer,
    save: vi.fn(async () => ({ kind: "saved" as const })), ...overrides,
  };
  return { deps, summarizer };
}

function prepared(plan: "free" | "pro" = "free", summarizer = makeSummarizer()): PreparedSummary {
  return prepareSummary(dashboard(plan), summarizer);
}

describe("prepareSummary", () => {
  it("builds only from the dashboard DTO and hashes the model with its summary input", () => {
    const dto = dashboard("free");
    const summarizer = makeSummarizer();
    const result = prepareSummary(dto, summarizer);
    expect(result.input).toEqual(buildSummaryInput(dto));
    expect(result).toMatchObject({ month: "2026-09", plan: "free", model: "claude-sonnet-5-5" });
    expect(summarizer.modelFor).toHaveBeenCalledExactlyOnceWith("free");
    expect(result.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same DTO and model, and changes when only the model changes", () => {
    const dto = dashboard();
    const same = makeSummarizer({ modelFor: () => "mock" });
    const different = makeSummarizer({ modelFor: () => "claude-sonnet-5-5" });
    expect(prepareSummary(dto, same).inputHash).toBe(prepareSummary(dto, same).inputHash);
    expect(prepareSummary(dto, same).inputHash).not.toBe(prepareSummary(dto, different).inputHash);
  });

  it("uses different hashes for Free and Pro DTOs built from the same transactions", () => {
    expect(prepareSummary(dashboard("free"), makeSummarizer()).inputHash)
      .not.toBe(prepareSummary(dashboard("pro"), makeSummarizer()).inputHash);
  });

  it("changes when a transaction category changes", () => {
    const before = prepareSummary(dashboard(), makeSummarizer());
    const changed = dashboard("free", transactions.map((row) => row.id === "tx-sep" ? { ...row, category: "shopping" } : row));
    expect(prepareSummary(changed, makeSummarizer()).inputHash).not.toBe(before.inputHash);
  });
});

describe("resolveMonthlySummary", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));

  it("fails on a stored-row read error without generating", async () => {
    const { deps, summarizer } = makeDeps({ loadStored: vi.fn().mockRejectedValue(new QueryError("getStoredSummary", "PGRST205")) });
    expect(await resolveMonthlySummary(userId, prepared(), deps)).toEqual({ kind: "failed" });
    expect(summarizer.summarize).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("summary:load:PGRST205", userId);
  });

  it("sanitizes unexpected stored-row read errors", async () => {
    const { deps, summarizer } = makeDeps({ loadStored: vi.fn().mockRejectedValue(new Error("private-value")) });
    expect(await resolveMonthlySummary(userId, prepared(), deps)).toEqual({ kind: "failed" });
    expect(summarizer.summarize).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("summary:load:unexpected_error", userId);
  });

  it("returns a matching stored summary without generating or saving", async () => {
    const prep = prepared();
    const { deps, summarizer } = makeDeps({
      loadStored: vi.fn(async () => ({ inputHash: prep.inputHash, summary: storedText } satisfies StoredSummary)),
    });
    expect(await resolveMonthlySummary(userId, prep, deps)).toEqual({ kind: "ready", text: storedText });
    expect(summarizer.summarize).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("fails when generation returns a failure and never leaks a stale stored summary", async () => {
    const prep = prepared();
    const { deps, summarizer } = makeDeps({
      loadStored: vi.fn(async () => ({ inputHash: "f".repeat(64), summary: storedText })),
    });
    vi.mocked(summarizer.summarize).mockResolvedValue({ ok: false, reason: "number" });
    expect(await resolveMonthlySummary(userId, prep, deps)).toEqual({ kind: "failed" });
    expect(summarizer.summarize).toHaveBeenCalledExactlyOnceWith(prep.input);
    expect(deps.save).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("summary:generate:number", userId);
  });

  it("saves a generated summary and returns it", async () => {
    const prep = prepared("pro");
    const { deps, summarizer } = makeDeps();
    expect(await resolveMonthlySummary(userId, prep, deps)).toEqual({ kind: "ready", text: generatedText });
    expect(summarizer.summarize).toHaveBeenCalledExactlyOnceWith(prep.input);
    expect(deps.save).toHaveBeenCalledExactlyOnceWith({
      userId, month: prep.month, plan: prep.plan, model: prep.model, inputHash: prep.inputHash, summary: generatedText,
    } satisfies SaveSummaryInput);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("fails and logs when save reports that the month's transactions were deleted", async () => {
    const { deps } = makeDeps({ save: vi.fn(async () => ({ kind: "no_transactions" as const })) });
    expect(await resolveMonthlySummary(userId, prepared(), deps)).toEqual({ kind: "failed" });
    expect(console.error).toHaveBeenCalledExactlyOnceWith("summary:save:no_transactions", userId);
  });

  it("returns verified text when saving throws and logs only the store code", async () => {
    const { deps } = makeDeps({ save: vi.fn().mockRejectedValue(new StoreError("save_ai_summary", "PGRST202")) });
    expect(await resolveMonthlySummary(userId, prepared(), deps)).toEqual({ kind: "ready", text: generatedText });
    expect(console.error).toHaveBeenCalledExactlyOnceWith("summary:save:PGRST202", userId);
  });

  it("catches a summarizer that unexpectedly throws", async () => {
    const summarizer = makeSummarizer({ summarize: vi.fn().mockRejectedValue(new Error("private-value")) });
    const { deps } = makeDeps({ summarizer });
    expect(await resolveMonthlySummary(userId, prepared(), deps)).toEqual({ kind: "failed" });
    expect(deps.save).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("summary:generate:unexpected_error", userId);
  });

  it("keeps all summary logs limited to a stage, code, and user id", async () => {
    const prep = prepared();
    const { deps } = makeDeps({
      loadStored: vi.fn().mockRejectedValue(new Error(`${generatedText} 예시 가맹점`)),
    });
    await resolveMonthlySummary(userId, prep, deps);
    for (const call of vi.mocked(console.error).mock.calls) {
      expect(call).toHaveLength(2);
      expect(call[1]).toBe(userId);
      expect(JSON.stringify(call)).not.toContain(generatedText);
      expect(JSON.stringify(call)).not.toContain("예시 가맹점");
    }
  });
});
