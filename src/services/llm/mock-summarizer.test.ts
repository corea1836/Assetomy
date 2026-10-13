import "server-only";
import { describe, expect, it } from "vitest";
import type { FreeSummaryInput, ProSummaryInput } from "@/types/summary";
import { checkSummaryText } from "./summary-text";
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

  it("returns the fixed plan-specific text and both pass summary validation", async () => {
    const summarizer = createMockSummarizer();
    const input = inputs();
    const free = await summarizer.summarize(input.free);
    const pro = await summarizer.summarize(input.pro);
    expect(free).toEqual({
      ok: true,
      text: "이번 달 지출을 카테고리와 가맹점 기준으로 정리했어요. 가장 많이 쓴 곳과 카테고리 비중을 함께 보면 흐름을 파악하기 쉬워요. 확인이 필요한 지출 후보는 정상 지출일 수 있으니 이용내역과 함께 확인해 주세요.",
    });
    expect(pro).toEqual({
      ok: true,
      text: "이번 달 지출과 확인이 필요한 지출 후보, 여러 달의 흐름을 함께 정리했어요. 후보 상세에서 정기결제와 중복 결제 의심을 하나씩 확인해 보세요. 후보 지출은 정상 지출일 수 있으니 실제 이용내역과 함께 확인해 주세요.",
    });
    if (!free.ok || !pro.ok) throw new Error("Expected fixed summaries");
    expect(checkSummaryText(free.text, input.free)).toEqual(free);
    expect(checkSummaryText(pro.text, input.pro)).toEqual(pro);
  });
});
