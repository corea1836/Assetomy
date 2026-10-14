import "server-only";
import type { Plan } from "@/types/dashboard";
import type { CardSummaryInput, SummaryContent, SummaryInput } from "@/types/summary";
import { checkSummaryContent } from "./summary-text";
import type { CardSummarizer, MonthlySummarizer } from "./types";

export const MOCK_SUMMARY_MODEL = "mock";

// 숫자는 실제 요약과 같은 자리표시자로 두고 summarize에서 입력 값으로 채운다.
const MOCK_CONTENT: Record<Plan, SummaryContent> = {
  free: {
    summary: "{period} 동안 {transactionCount}, {total}을 썼어요. 가장 많이 쓴 곳과 카테고리 비중을 함께 보면 지출 흐름을 파악하기 쉬워요.",
    tips: [
      "비중이 가장 큰 카테고리는 다음 달 예산을 먼저 정해 두세요. 지출이 한꺼번에 몰리는 걸 막을 수 있어요.",
      "자주 결제한 가맹점은 한 주에 몇 번까지 쓸지 정해 보세요. 작은 결제도 쌓이면 커져요.",
      "확인이 필요한 지출 후보가 있다면 카드사 앱 승인 내역에서 같은 결제가 두 번 청구되지 않았는지 확인해 보세요. 정상 지출일 수도 있어요.",
    ],
  },
  pro: {
    summary: "{period} 동안 {transactionCount}, {total}을 썼어요. 확인이 필요한 지출 후보와 여러 달의 흐름을 함께 정리했어요.",
    tips: [
      "후보 상세의 정기결제가 아직 쓰는 서비스인지 하나씩 점검해 보세요. 쓰지 않는 구독은 해지하면 다음 달부터 결제되지 않아요.",
      "중복 결제 의심은 카드사 앱 승인 내역에서 같은 결제가 두 번 청구됐는지 확인해 보세요. 정상 지출일 수도 있어요.",
      "비중이 가장 큰 카테고리는 다음 달 예산을 먼저 정해 두세요.",
    ],
  },
};

export const MOCK_CARD_SUMMARY_MODEL = MOCK_SUMMARY_MODEL;

const MOCK_CARD_CONTENT: Record<Plan, SummaryContent> = {
  free: {
    summary: "{period} 동안 이 카드로 {transactionCount}, {total}을 썼어요. 비중이 큰 카테고리와 자주 쓴 곳을 함께 보면 지출 흐름을 파악하기 쉬워요.",
    tips: [
      "비중이 큰 카테고리의 예산을 정하고 다음 이용 기간 뒤에 살펴보세요.",
      "자주 결제한 가맹점은 한 주에 이용할 횟수를 정해 보세요.",
    ],
  },
  pro: {
    summary: "{period} 동안 이 카드로 {transactionCount}, {total}을 썼어요. 비중이 큰 카테고리와 자주 쓴 곳을 함께 보면 지출 흐름을 파악하기 쉬워요.",
    tips: [
      "비중이 큰 카테고리의 예산을 정하고 다음 이용 기간 뒤에 살펴보세요.",
      "자주 결제한 가맹점은 한 주에 이용할 횟수를 정해 보세요.",
      "지난달이나 지난 명세서와 달라진 카테고리가 있으면 그 이유를 살펴보세요.",
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
      return checkSummaryContent(MOCK_CONTENT[input.plan], input);
    },
  };
}

export function createMockCardSummarizer(): CardSummarizer {
  return {
    modelFor(plan: Plan) {
      void plan;
      return MOCK_CARD_SUMMARY_MODEL;
    },
    promptFor(plan: Plan) {
      return JSON.stringify(MOCK_CARD_CONTENT[plan]);
    },
    async summarize(input: CardSummaryInput) {
      return checkSummaryContent(MOCK_CARD_CONTENT[input.plan], input);
    },
  };
}
