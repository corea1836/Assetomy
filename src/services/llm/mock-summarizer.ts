import "server-only";
import type { Plan } from "@/types/dashboard";
import type { SummaryInput } from "@/types/summary";
import type { MonthlySummarizer } from "./types";

export const MOCK_SUMMARY_MODEL = "mock";

const FREE_SUMMARY = "이번 달 지출을 카테고리와 가맹점 기준으로 정리했어요. 가장 많이 쓴 곳과 카테고리 비중을 함께 보면 흐름을 파악하기 쉬워요. 확인이 필요한 지출 후보는 정상 지출일 수 있으니 이용내역과 함께 확인해 주세요.";
const PRO_SUMMARY = "이번 달 지출과 확인이 필요한 지출 후보, 여러 달의 흐름을 함께 정리했어요. 후보 상세에서 정기결제와 중복 결제 의심을 하나씩 확인해 보세요. 후보 지출은 정상 지출일 수 있으니 실제 이용내역과 함께 확인해 주세요.";

export function createMockSummarizer(): MonthlySummarizer {
  return {
    modelFor(plan: Plan) {
      void plan;
      return MOCK_SUMMARY_MODEL;
    },
    async summarize(input: SummaryInput) {
      return { ok: true, text: input.plan === "free" ? FREE_SUMMARY : PRO_SUMMARY };
    },
  };
}
