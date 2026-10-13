import "server-only";
import type { CategoryId } from "@/types/category";
import type { MerchantClassifier } from "./types";

// First match wins; delivery must precede shopping for 쿠팡이츠.
const KEYWORD_RULES: ReadonlyArray<readonly [string, CategoryId]> = [
  ["스타벅스", "cafe"], ["커피", "cafe"], ["카페", "cafe"],
  ["배달의민족", "delivery"], ["쿠팡이츠", "delivery"], ["요기요", "delivery"],
  ["택시", "transport"], ["지하철", "transport"], ["버스", "transport"], ["코레일", "transport"],
  ["이마트", "grocery"], ["홈플러스", "grocery"], ["롯데마트", "grocery"],
  ["GS25", "grocery"], ["CU", "grocery"], ["세븐일레븐", "grocery"],
  ["넷플릭스", "subscription"], ["NETFLIX", "subscription"], ["유튜브", "subscription"],
  ["YOUTUBE", "subscription"], ["SPOTIFY", "subscription"],
  ["쿠팡", "shopping"], ["무신사", "shopping"],
  ["병원", "health"], ["약국", "health"], ["의원", "health"],
  ["CGV", "culture"], ["메가박스", "culture"],
  ["호텔", "travel"], ["항공", "travel"],
  ["통신", "housing"], ["관리비", "housing"], ["보험", "finance"],
  ["학원", "education"], ["식당", "food"], ["김밥", "food"],
];

export function createMockClassifier(): MerchantClassifier {
  return {
    async classify(merchants) {
      const categories = new Map<string, CategoryId>();
      for (const { merchantKey } of merchants) {
        if (categories.has(merchantKey)) continue;
        const rule = KEYWORD_RULES.find(([keyword]) => merchantKey.includes(keyword));
        categories.set(merchantKey, rule?.[1] ?? "etc");
      }
      return categories;
    },
  };
}
