import "server-only";
import { createHash } from "node:crypto";
import { buildCardSummaryInput } from "@/lib/analytics/summary-input";
import { QueryError } from "@/lib/queries/query-error";
import { StoreError } from "@/lib/store/store-error";
import type { CardDashboard } from "@/types/dashboard";
import type {
  CardSummaryInput, MonthlySummaryView, SaveCardSummaryInput, SaveCardSummaryResult, StoredSummary,
} from "@/types/summary";
import type { CardSummarizer } from "@/services/llm/types";

export type PreparedCardSummary = {
  cardId: string;
  period: string;
  plan: CardDashboard["plan"];
  model: string;
  input: CardSummaryInput;
  inputHash: string;
};

export function prepareCardSummary(
  dashboard: CardDashboard,
  summarizer: Pick<CardSummarizer, "modelFor" | "promptFor">,
): PreparedCardSummary {
  const input = buildCardSummaryInput(dashboard);
  const model = summarizer.modelFor(dashboard.plan);
  const prompt = summarizer.promptFor(dashboard.plan);
  const period = dashboard.basis === "month" ? dashboard.month : dashboard.statementDate;
  const inputHash = createHash("sha256").update(JSON.stringify({ model, prompt, input })).digest("hex");
  return { cardId: dashboard.card.id, period, plan: dashboard.plan, model, input, inputHash };
}

export type CardSummaryDeps = {
  loadStored: (userId: string, cardId: string, period: string) => Promise<StoredSummary | null>;
  summarizer: CardSummarizer;
  save: (input: SaveCardSummaryInput) => Promise<SaveCardSummaryResult>;
};

function errorCode(error: unknown): string {
  if (error instanceof QueryError || error instanceof StoreError) return error.code;
  return "unexpected_error";
}

export async function resolveCardSummary(
  userId: string,
  prepared: PreparedCardSummary,
  deps: CardSummaryDeps,
): Promise<MonthlySummaryView> {
  let stored: StoredSummary | null;
  try {
    stored = await deps.loadStored(userId, prepared.cardId, prepared.period);
  } catch (error) {
    console.error(`summary:card:load:${errorCode(error)}`, userId);
    return { kind: "failed" };
  }

  if (stored?.inputHash === prepared.inputHash) {
    return { kind: "ready", summary: stored.summary, tips: stored.tips };
  }

  let result;
  try {
    result = await deps.summarizer.summarize(prepared.input);
  } catch {
    console.error("summary:card:generate:unexpected_error", userId);
    return { kind: "failed" };
  }

  if (!result.ok) {
    console.error(`summary:card:generate:${result.reason}`, userId);
    return { kind: "failed" };
  }

  const { summary, tips } = result;
  try {
    const saved = await deps.save({
      userId,
      cardId: prepared.cardId,
      period: prepared.period,
      plan: prepared.plan,
      model: prepared.model,
      inputHash: prepared.inputHash,
      summary,
      tips,
    });
    if (saved.kind === "saved") return { kind: "ready", summary, tips };
    console.error(`summary:card:save:${saved.kind}`, userId);
    return { kind: "failed" };
  } catch (error) {
    console.error(`summary:card:save:${errorCode(error)}`, userId);
    return { kind: "ready", summary, tips };
  }
}
