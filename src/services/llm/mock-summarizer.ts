import "server-only";
import type { Plan } from "@/types/dashboard";
import type { SummaryContent, SummaryInput } from "@/types/summary";
import type { MonthlySummarizer } from "./types";

export const MOCK_SUMMARY_MODEL = "mock";

const MOCK_CONTENT: Record<Plan, SummaryContent> = {
  free: {
    summary: "이번 달 지출을 카테고리와 가맹점 기준으로 정리했어요. 가장 많이 쓴 곳과 카테고리 비중을 함께 보면 흐름을 파악하기 쉬워요.",
    tips: [
      "확인이 필요한 지출 후보가 있다면 카드사 앱 승인 내역에서 같은 결제가 두 번 청구되지 않았는지 확인해 보세요. 정상 지출일 수도 있어요.",
      "비중이 가장 큰 카테고리는 다음 달 예산을 먼저 정해 보세요.",
    ],
  },
  pro: {
    summary: "이번 달 지출과 확인이 필요한 지출 후보, 여러 달의 흐름을 함께 정리했어요.",
    tips: [
      "후보 상세의 정기결제가 아직 쓰는 서비스인지 하나씩 점검해 보세요.",
      "중복 결제 의심은 카드사 앱 승인 내역에서 같은 결제가 두 번 청구됐는지 확인해 보세요. 정상 지출일 수도 있어요.",
    ],
  },
};

export function createMockSummarizer(): MonthlySummarizer {
  return {
    modelFor(plan: Plan) {
      void plan;
      return MOCK_SUMMARY_MODEL;
    },
    promptFor(plan: Plan) {
      return JSON.stringify(MOCK_CONTENT[plan]);
    },
    async summarize(input: SummaryInput) {
      const { summary, tips } = MOCK_CONTENT[input.plan];
      return { ok: true, summary, tips: [...tips] };
    },
  };
}
