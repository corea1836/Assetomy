export const CATEGORY_IDS = [
  "food",
  "cafe",
  "delivery",
  "transport",
  "shopping",
  "grocery",
  "subscription",
  "housing",
  "health",
  "culture",
  "travel",
  "education",
  "finance",
  "etc",
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export type MerchantCategoryRequest = { merchantKey: string; category: CategoryId };
export type MerchantCategoryResponse = { updated: number };

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  food: "식비",
  cafe: "카페·간식",
  delivery: "배달",
  transport: "교통",
  shopping: "쇼핑",
  grocery: "마트·생활",
  subscription: "구독·정기결제",
  housing: "주거·통신",
  health: "의료·건강",
  culture: "문화·여가",
  travel: "여행·숙박",
  education: "교육",
  finance: "금융·보험",
  etc: "기타",
};
