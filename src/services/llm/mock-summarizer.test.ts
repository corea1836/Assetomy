import "server-only";
import { describe, expect, it } from "vitest";
import type { CardSummaryInput, FreeSummaryInput, ProSummaryInput } from "@/types/summary";
import { checkSummaryContent } from "./summary-text";
import { createMockCardSummarizer, createMockSummarizer, MOCK_SUMMARY_MODEL, MOCK_CARD_SUMMARY_MODEL } from "./mock-summarizer";

function inputs() {
  const shared = {
    month: "2026-09", inProgress: false,
    period: { from: "2026-09-01", to: "2026-09-30" }, total: 1000, transactionCount: 1,
    categories: [], topMerchants: [], monthOverMonth: null, partialMonth: null,
    candidates: {
      recurring: { count: 0, amount: 0 }, duplicate: { count: 0, amount: 0 },
      large: { count: 0, amount: 0 }, candidateTotal: 0,
    },
  };
  return {
    free: { ...shared, plan: "free" } as FreeSummaryInput,
    pro: { ...shared, plan: "pro", findings: [], trend: null } as ProSummaryInput,
  };
}

describe("createMockSummarizer", () => {
  it("uses the fixed mock model for either plan", () => {
    const summarizer = createMockSummarizer();
    expect(MOCK_SUMMARY_MODEL).toBe("mock");
    expect(summarizer.modelFor("free")).toBe("mock");
    expect(summarizer.modelFor("pro")).toBe("mock");
  });

  it("returns fixed plan-specific content with placeholders filled from the input", async () => {
    const summarizer = createMockSummarizer();
    const input = inputs();
    const free = await summarizer.summarize(input.free);
    const pro = await summarizer.summarize(input.pro);
    expect(free).toEqual({
      ok: true,
      summary: "9월 1일~9월 30일 동안 1건, 1,000원을 썼어요. 가장 많이 쓴 곳과 카테고리 비중을 함께 보면 지출 흐름을 파악하기 쉬워요.",
      tips: [
        "비중이 가장 큰 카테고리는 다음 달 예산을 먼저 정해 두세요. 지출이 한꺼번에 몰리는 걸 막을 수 있어요.",
        "자주 결제한 가맹점은 한 주에 몇 번까지 쓸지 정해 보세요. 작은 결제도 쌓이면 커져요.",
        "확인이 필요한 지출 후보가 있다면 카드사 앱 승인 내역에서 같은 결제가 두 번 청구되지 않았는지 확인해 보세요. 정상 지출일 수도 있어요.",
      ],
    });
    expect(pro).toEqual({
      ok: true,
      summary: "9월 1일~9월 30일 동안 1건, 1,000원을 썼어요. 확인이 필요한 지출 후보와 여러 달의 흐름을 함께 정리했어요.",
      tips: [
        "후보 상세의 정기결제가 아직 쓰는 서비스인지 하나씩 점검해 보세요. 쓰지 않는 구독은 해지하면 다음 달부터 결제되지 않아요.",
        "중복 결제 의심은 카드사 앱 승인 내역에서 같은 결제가 두 번 청구됐는지 확인해 보세요. 정상 지출일 수도 있어요.",
        "비중이 가장 큰 카테고리는 다음 달 예산을 먼저 정해 두세요.",
      ],
    });
  });

  it("uses the fixed template as the prompt so changing it regenerates stored summaries", () => {
    const summarizer = createMockSummarizer();
    for (const plan of ["free", "pro"] as const) {
      const template = JSON.parse(summarizer.promptFor(plan)) as { summary: string; tips: string[] };
      expect(template.summary).toContain("{total}");
      expect(checkSummaryContent(template, inputs()[plan])).toMatchObject({ ok: true });
    }
    expect(summarizer.promptFor("free")).not.toBe(summarizer.promptFor("pro"));
  });
});

describe("createMockCardSummarizer", () => {
  it.each([
    { plan: "free", scope: "month" },
    { plan: "free", scope: "statement" },
    { plan: "pro", scope: "month" },
    { plan: "pro", scope: "statement" },
  ] as const)("returns validated card content for $plan/$scope", async ({ plan, scope }) => {
    const shared = {
      scope, period: { from: "2026-09-12", to: "2026-10-11" }, inProgress: false,
      total: 10_000, transactionCount: 4,
      categories: [{ category: "식비", amount: 8_000, ratio: 0.8 }],
      topMerchants: [{ merchant: "가게", category: "식비", amount: 8_000, count: 2 }],
      comparison: null, comparisonSkipped: false,
    };
    const input: CardSummaryInput = plan === "free"
      ? { ...shared, plan }
      : { ...shared, plan, categoryChanges: null };
    const summarizer = createMockCardSummarizer();
    const result = await summarizer.summarize(input);
    expect(MOCK_CARD_SUMMARY_MODEL).toBe("mock");
    expect(summarizer.modelFor(plan)).toBe("mock");
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("Expected mock card summary to validate");
    expect(result.summary).toContain("9월 12일~10월 11일");
    expect(result.summary).toContain("4건");
    expect(result.summary).toContain("10,000원");
    expect(checkSummaryContent(JSON.parse(summarizer.promptFor(plan)), input)).toMatchObject({ ok: true });
    expect(result.tips.length).toBeGreaterThanOrEqual(2);
    expect(result.tips.length).toBeLessThanOrEqual(3);
  });
});
