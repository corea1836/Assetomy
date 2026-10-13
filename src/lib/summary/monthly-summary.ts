import "server-only";
import { createHash } from "node:crypto";
import { buildSummaryInput } from "@/lib/analytics/summary-input";
import { QueryError } from "@/lib/queries/query-error";
import { StoreError } from "@/lib/store/store-error";
import type { Dashboard } from "@/types/dashboard";
import type {
  MonthlySummaryView, SaveSummaryInput, SaveSummaryResult, StoredSummary, SummaryInput,
} from "@/types/summary";
import type { YearMonth } from "@/types/transaction";
import type { MonthlySummarizer } from "@/services/llm/types";

export type PreparedSummary = {
  month: YearMonth;
  plan: Dashboard["plan"];
  model: string;
  input: SummaryInput;
  inputHash: string;
};

export function prepareSummary(
  dashboard: Dashboard,
  summarizer: Pick<MonthlySummarizer, "modelFor">,
): PreparedSummary {
  const input = buildSummaryInput(dashboard);
  const model = summarizer.modelFor(dashboard.plan);
  const inputHash = createHash("sha256").update(JSON.stringify({ model, input })).digest("hex");
  return { month: dashboard.month, plan: dashboard.plan, model, input, inputHash };
}

export type SummaryDeps = {
  loadStored: (userId: string, month: YearMonth) => Promise<StoredSummary | null>;
  summarizer: MonthlySummarizer;
  save: (input: SaveSummaryInput) => Promise<SaveSummaryResult>;
};

function errorCode(error: unknown): string {
  if (error instanceof QueryError || error instanceof StoreError) return error.code;
  return "unexpected_error";
}

export async function resolveMonthlySummary(
  userId: string,
  prepared: PreparedSummary,
  deps: SummaryDeps,
): Promise<MonthlySummaryView> {
  let stored: StoredSummary | null;
  try {
    stored = await deps.loadStored(userId, prepared.month);
  } catch (error) {
    console.error(`summary:load:${errorCode(error)}`, userId);
    return { kind: "failed" };
  }

  if (stored?.inputHash === prepared.inputHash) return { kind: "ready", text: stored.summary };

  let result;
  try {
    result = await deps.summarizer.summarize(prepared.input);
  } catch {
    console.error("summary:generate:unexpected_error", userId);
    return { kind: "failed" };
  }

  if (!result.ok) {
    console.error(`summary:generate:${result.reason}`, userId);
    return { kind: "failed" };
  }

  const text = result.text;
  try {
    const saved = await deps.save({
      userId,
      month: prepared.month,
      plan: prepared.plan,
      model: prepared.model,
      inputHash: prepared.inputHash,
      summary: text,
    });
    if (saved.kind === "saved") return { kind: "ready", text };
    console.error("summary:save:no_transactions", userId);
    return { kind: "failed" };
  } catch (error) {
    console.error(`summary:save:${errorCode(error)}`, userId);
    return { kind: "ready", text };
  }
}
