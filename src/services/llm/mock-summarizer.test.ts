import "server-only";
import { describe, expect, it } from "vitest";
import type { FreeSummaryInput, ProSummaryInput } from "@/types/summary";
import { checkSummaryContent } from "./summary-text";
import { createMockSummarizer, MOCK_SUMMARY_MODEL } from "./mock-summarizer";

function inputs() {
  const shared = {
    month: "2026-09", inProgress: false,
    period: { from: "2026-09-01", to: "2026-09-30" }, total: 1000, transactionCount: 1,
    categories: [], topMerchants: [], monthOverMonth: null,
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

  it("returns fixed plan-specific content that passes validation", async () => {
    const summarizer = createMockSummarizer();
    const input = inputs();
    const free = await summarizer.summarize(input.free);
    const pro = await summarizer.summarize(input.pro);
    expect(free).toEqual({
      ok: true,
      summary: "이번 달 지출을 카테고리와 가맹점 기준으로 정리했어요. 가장 많이 쓴 곳과 카테고리 비중을 함께 보면 흐름을 파악하기 쉬워요.",
      tips: [
        "확인이 필요한 지출 후보가 있다면 카드사 앱 승인 내역에서 같은 결제가 두 번 청구되지 않았는지 확인해 보세요. 정상 지출일 수도 있어요.",
        "비중이 가장 큰 카테고리는 다음 달 예산을 먼저 정해 보세요.",
      ],
    });
    expect(pro).toEqual({
      ok: true,
      summary: "이번 달 지출과 확인이 필요한 지출 후보, 여러 달의 흐름을 함께 정리했어요.",
      tips: [
        "후보 상세의 정기결제가 아직 쓰는 서비스인지 하나씩 점검해 보세요.",
        "중복 결제 의심은 카드사 앱 승인 내역에서 같은 결제가 두 번 청구됐는지 확인해 보세요. 정상 지출일 수도 있어요.",
      ],
    });
    if (!free.ok || !pro.ok) throw new Error("Expected fixed summaries");
    expect(checkSummaryContent(free, input.free)).toEqual(free);
    expect(checkSummaryContent(pro, input.pro)).toEqual(pro);
  });

  it("uses the fixed content as the prompt so changing it regenerates stored summaries", async () => {
    const summarizer = createMockSummarizer();
    const input = inputs();
    const free = await summarizer.summarize(input.free);
    const pro = await summarizer.summarize(input.pro);
    if (!free.ok || !pro.ok) throw new Error("Expected fixed summaries");
    expect(summarizer.promptFor("free")).toBe(JSON.stringify({ summary: free.summary, tips: free.tips }));
    expect(summarizer.promptFor("pro")).toBe(JSON.stringify({ summary: pro.summary, tips: pro.tips }));
  });
});
