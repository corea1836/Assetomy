import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStoredSummary } from "@/lib/queries/summaries";
import { saveSummary } from "@/lib/store/summaries";
import { getMonthlySummarizer } from "@/services/llm";
import { defaultSummaryDeps } from "./deps";

vi.mock("@/lib/queries/summaries", () => ({ getStoredSummary: vi.fn() }));
vi.mock("@/lib/store/summaries", () => ({ saveSummary: vi.fn() }));
vi.mock("@/services/llm", () => ({ getMonthlySummarizer: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("defaultSummaryDeps", () => {
  it("wires stored-summary reads, the selected summarizer, and the summary store", async () => {
    const supabase = {} as SupabaseClient;
    const summarizer = { modelFor: vi.fn(), promptFor: vi.fn(), summarize: vi.fn() };
    vi.mocked(getMonthlySummarizer).mockReturnValue(summarizer);
    const deps = defaultSummaryDeps(supabase);

    expect(deps.summarizer).toBe(summarizer);
    expect(getMonthlySummarizer).toHaveBeenCalledExactlyOnceWith();
    await deps.loadStored("user-a", "2026-09");
    expect(getStoredSummary).toHaveBeenCalledExactlyOnceWith(supabase, "user-a", "2026-09");
    await deps.save({
      userId: "user-a", month: "2026-09", plan: "free", model: "mock",
      inputHash: "a".repeat(64), summary: "요약", tips: ["팁"],
    });
    expect(deps.save).toBe(saveSummary);
    expect(saveSummary).toHaveBeenCalledExactlyOnceWith({
      userId: "user-a", month: "2026-09", plan: "free", model: "mock",
      inputHash: "a".repeat(64), summary: "요약", tips: ["팁"],
    });
  });
});
