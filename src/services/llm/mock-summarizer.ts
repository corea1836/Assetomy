import "server-only";
import type { Plan } from "@/types/dashboard";
import type { CardSummaryInput, SummaryDraft, SummaryInput } from "@/types/summary";
import { checkSummaryContent } from "./summary-text";
import type { CardSummarizer, MonthlySummarizer } from "./types";

export const MOCK_SUMMARY_MODEL = "mock";
export const MOCK_CARD_SUMMARY_MODEL = MOCK_SUMMARY_MODEL;

const MONTHLY_SUMMARY: Record<Plan, string> = {
  free: "{period} 동안 {transactionCount}, {total}을 썼어요. 가장 많이 쓴 곳과 카테고리 비중을 함께 보면 지출 흐름을 파악하기 쉬워요.",
  pro: "{period} 동안 {transactionCount}, {total}을 썼어요. 확인이 필요한 지출 후보와 여러 달의 흐름을 함께 정리했어요.",
};

const CARD_SUMMARY: Record<Plan, string> = {
  free: "{period} 동안 이 카드로 {transactionCount}, {total}을 썼어요. 비중이 큰 카테고리와 자주 쓴 곳을 함께 보면 지출 흐름을 파악하기 쉬워요.",
  pro: "{period} 동안 이 카드로 {transactionCount}, {total}을 썼어요. 비중이 큰 카테고리와 자주 쓴 곳을 함께 보면 지출 흐름을 파악하기 쉬워요.",
};

const TIP_TEXT_TEMPLATES = [
  (name: string, index: number) => `${name} 지출은 {categories[${index}].amount}이에요. 다음 달 예산을 먼저 정해 보세요.`,
  (name: string) => `${name} 지출은 자주 가는 곳부터 한 주에 갈 횟수를 정해 보세요.`,
  (name: string) => `${name} 지출이 지난번과 달라졌다면 그 이유를 살펴보세요.`,
] as const;

const PROMPT_TIP_TEMPLATES = [
  { category: "<카테고리>", text: "<카테고리> 지출은 0원이에요. 다음 달 예산을 먼저 정해 보세요." },
  { category: "<카테고리>", text: "<카테고리> 지출은 자주 가는 곳부터 한 주에 갈 횟수를 정해 보세요." },
  { category: "<카테고리>", text: "<카테고리> 지출이 지난번과 달라졌다면 그 이유를 살펴보세요." },
];

function tipCount(plan: Plan, scope: "month" | "card"): number {
  if (scope === "month") return 3;
  return plan === "free" ? 2 : 3;
}

function promptDraft(plan: Plan, scope: "month" | "card"): SummaryDraft {
  const count = tipCount(plan, scope);
  return {
    summary: scope === "month" ? MONTHLY_SUMMARY[plan] : CARD_SUMMARY[plan],
    comparison: scope === "month"
      ? "지난달보다 {monthOverMonth.diff} 늘었어요."
      : "지난 기간보다 {comparison.diff} 늘었어요. 최근 세 번은 계속 늘었어요.",
    tips: PROMPT_TIP_TEMPLATES.slice(0, count),
  };
}

function monthlyComparison(input: SummaryInput | CardSummaryInput): string {
  if (!("monthOverMonth" in input)) return "";
  if (input.monthOverMonth !== null) {
    if (input.monthOverMonth.direction === "up") return "지난달보다 {monthOverMonth.diff} 늘었어요.";
    if (input.monthOverMonth.direction === "down") return "지난달보다 {monthOverMonth.diff} 줄었어요.";
    return "지난달과 같아요.";
  }
  if (input.partialMonth !== null) {
    const month = Number(input.partialMonth.split("-")[1]);
    return `${month}월 내역이 일부만 있어 지난달과는 비교하지 않았어요.`;
  }
  return "";
}

function cardComparison(input: SummaryInput | CardSummaryInput): string {
  if (!("comparison" in input)) return "";
  const previous = input.scope === "month" ? "지난달" : "지난 명세서";
  const sentences: string[] = [];
  if (input.comparison !== null) {
    if (input.comparison.direction === "up") sentences.push(`${previous}보다 {comparison.diff} 늘었어요.`);
    else if (input.comparison.direction === "down") sentences.push(`${previous}보다 {comparison.diff} 줄었어요.`);
    else sentences.push(input.scope === "month" ? "지난달과 같아요." : "지난 명세서와 같아요.");
  } else if (input.comparisonSkipped) {
    sentences.push(input.scope === "month"
      ? "카드 내역이 일부만 있어 지난달과 비교하지 않았어요."
      : "이용 기간이 끝나기 전에 받은 명세서가 있어 지난 명세서와 비교하지 않았어요.");
  }

  if (input.flow !== null) {
    if (input.flow.direction === "rising") sentences.push("최근 세 번은 계속 늘었어요.");
    else if (input.flow.direction === "falling") sentences.push("최근 세 번은 계속 줄었어요.");
    else if (input.flow.direction === "steady") sentences.push("최근 세 번은 비슷했어요.");
    else sentences.push("최근 세 번은 한 방향으로 이어지지 않았어요.");
  }
  return sentences.join(" ");
}

function buildDraft(input: SummaryInput | CardSummaryInput, scope: "month" | "card"): SummaryDraft {
  const categories = input.categories.map((category, index) => ({ ...category, index }));
  const preferred = categories.filter(({ category }) => category !== "기타");
  const available = preferred.length > 0 ? preferred : categories;
  const count = Math.min(tipCount(input.plan, scope), available.length);
  const tips = available.slice(0, count).map((category, index) => ({
    category: category.category,
    text: TIP_TEXT_TEMPLATES[index](category.category, category.index),
  }));

  return {
    summary: scope === "month" ? MONTHLY_SUMMARY[input.plan] : CARD_SUMMARY[input.plan],
    comparison: scope === "month" ? monthlyComparison(input) : cardComparison(input),
    tips,
  };
}

export function createMockSummarizer(): MonthlySummarizer {
  return {
    modelFor(plan: Plan) {
      void plan;
      return MOCK_SUMMARY_MODEL;
    },
    promptFor(plan: Plan) {
      return JSON.stringify(promptDraft(plan, "month"));
    },
    async summarize(input: SummaryInput) {
      return checkSummaryContent(buildDraft(input, "month"), input);
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
      return JSON.stringify(promptDraft(plan, "card"));
    },
    async summarize(input: CardSummaryInput) {
      return checkSummaryContent(buildDraft(input, "card"), input);
    },
  };
}
