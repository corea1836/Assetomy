import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MonthlySummary, MonthlySummaryStatus } from "@/components/dashboard/monthly-summary";
import { resolveCardSummary, type CardSummaryDeps, type PreparedCardSummary } from "@/lib/summary/card-summary";
import type { SummaryFeedback } from "@/types/summary";
import { CardSummarySection } from "./card-summary-section";

vi.mock("@/lib/summary/card-summary", () => ({ resolveCardSummary: vi.fn() }));
vi.mock("@/components/dashboard/monthly-summary", () => ({
  MonthlySummary: vi.fn(({ summary }: { summary: string }) => <section>{summary}</section>),
  MonthlySummaryStatus: vi.fn(({ state }: { state: string }) => <section>{state} 카드 요약</section>),
}));

const prepared: PreparedCardSummary = {
  cardId: "11111111-1111-4111-8111-111111111111",
  period: "2026-10",
  plan: "free",
  model: "test-model",
  input: {} as PreparedCardSummary["input"],
  inputHash: "card-summary-hash",
};
const deps = {} as CardSummaryDeps;

beforeEach(() => {
  vi.mocked(resolveCardSummary).mockReset();
  vi.mocked(MonthlySummary).mockClear();
  vi.mocked(MonthlySummaryStatus).mockClear();
});

describe("CardSummarySection", () => {
  it("renders a ready card-month summary with its variant and Free upgrade prompt", async () => {
    vi.mocked(resolveCardSummary).mockResolvedValue({ kind: "ready", summary: "준비된 카드 요약이에요.", tips: ["팁이에요."], tipCategories: ["food"] });
    const feedback: SummaryFeedback = { food: "평일 점심은 회사에서 먹어요" };

    render(await CardSummarySection({ userId: "session-user", prepared, deps, variant: "card-month", feedback }));

    expect(screen.getByText("준비된 카드 요약이에요.")).toBeInTheDocument();
    expect(resolveCardSummary).toHaveBeenCalledExactlyOnceWith("session-user", prepared, deps);
    expect(vi.mocked(MonthlySummary).mock.calls[0][0]).toEqual({
      summary: "준비된 카드 요약이에요.", tips: ["팁이에요."], tipCategories: ["food"], feedback, feedbackEnabled: true,
      source: "ai", upgrade: true, variant: "card-month",
    });
    expect(MonthlySummaryStatus).not.toHaveBeenCalled();
  });

  it("renders a failed statement summary with its variant and no Pro upgrade prompt", async () => {
    vi.mocked(resolveCardSummary).mockResolvedValue({ kind: "failed" });
    const proPrepared = { ...prepared, plan: "pro" as const };

    render(await CardSummarySection({ userId: "session-user", prepared: proPrepared, deps, variant: "statement", feedback: { food: "표시되지 않아요" } }));

    expect(screen.getByText("failed 카드 요약")).toBeInTheDocument();
    expect(vi.mocked(MonthlySummaryStatus).mock.calls[0][0]).toEqual({ state: "failed", variant: "statement", upgrade: false });
    expect(MonthlySummary).not.toHaveBeenCalled();
  });
});
