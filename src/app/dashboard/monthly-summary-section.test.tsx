import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildDashboard } from "@/lib/analytics/dashboard";
import { DEMO_TODAY, DEMO_TRANSACTIONS } from "@/lib/demo/fixture";
import type { MonthlySummarizer, SummaryResult } from "@/services/llm/types";
import type { Dashboard } from "@/types/dashboard";
import type { SummaryDeps } from "@/lib/summary/monthly-summary";
import { prepareSummary } from "@/lib/summary/monthly-summary";
import { MonthlySummarySection } from "./monthly-summary-section";

const userId = "summary-section-user";
const storedText = "저장된 이번 달 요약이에요.";
const storedTips = ["저장된 팁이에요. 카드사 앱에서 확인해 보세요."];

function makePrepared(plan: "free" | "pro") {
  const dashboard = buildDashboard({ transactions: DEMO_TRANSACTIONS, plan, today: DEMO_TODAY });
  if (!dashboard) throw new Error("Expected dashboard DTO");
  const summarizer = makeSummarizer();
  return prepareSummary(dashboard as Dashboard, summarizer);
}

function makeSummarizer(result: SummaryResult = { ok: true, summary: "새 요약이에요.", tips: ["새 팁이에요."] }): MonthlySummarizer {
  return {
    modelFor: (plan) => plan === "free" ? "test-free-model" : "test-pro-model",
    promptFor: (plan) => `${plan} prompt`,
    summarize: vi.fn(async () => result),
  };
}

function makeDeps(prepared: ReturnType<typeof makePrepared>, overrides: Partial<SummaryDeps> = {}): SummaryDeps {
  return {
    loadStored: vi.fn(async () => ({ inputHash: prepared.inputHash, summary: storedText, tips: storedTips })),
    summarizer: makeSummarizer(),
    save: vi.fn(async () => ({ kind: "saved" as const })),
    ...overrides,
  };
}

describe("MonthlySummarySection", () => {
  it.each(["free", "pro"] as const)("reuses the stored %s summary", async (plan) => {
    const prepared = makePrepared(plan);
    const deps = makeDeps(prepared);

    render(await MonthlySummarySection({ userId, prepared, deps }));

    expect(screen.getByText(storedText)).toBeInTheDocument();
    expect(screen.getByText(storedTips[0])).toBeInTheDocument();
    expect(screen.getByText("AI가 가맹점명과 집계로 쓴 요약이에요. 금액은 코드로 계산해요.")).toBeInTheDocument();
    if (plan === "free") {
      expect(screen.getByRole("button", { name: "Pro로 보기" })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole("button", { name: "Pro로 보기" })).not.toBeInTheDocument();
    }
    expect(deps.summarizer.summarize).not.toHaveBeenCalled();
  });

  it("shows the failed state without exposing a saved summary with a different hash", async () => {
    const prepared = makePrepared("free");
    const deps = makeDeps(prepared, {
      loadStored: vi.fn(async () => ({ inputHash: "old-input-hash", summary: "이전 요약은 보여주면 안 돼요.", tips: ["이전 팁도 보여주면 안 돼요."] })),
      summarizer: makeSummarizer({ ok: false, reason: "request_failed" }),
    });

    render(await MonthlySummarySection({ userId, prepared, deps }));

    expect(screen.getByText("요약을 만들지 못했어요. 새로고침하면 다시 만들어요.")).toBeInTheDocument();
    expect(screen.queryByText("이전 요약은 보여주면 안 돼요.")).not.toBeInTheDocument();
    expect(screen.queryByText("이전 팁도 보여주면 안 돼요.")).not.toBeInTheDocument();
    expect(screen.queryByText("AI가 가맹점명과 집계로 쓴 요약이에요. 금액은 코드로 계산해요.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pro로 보기" })).toBeInTheDocument();
  });
});
