export const CARD_ISSUERS = [
  "hyundai",
  "shinhan",
  "samsung",
  "kb",
  "lotte",
  "hana",
  "woori",
  "bc",
  "nh",
] as const;

export type CardIssuer = (typeof CARD_ISSUERS)[number];

export const ANALYSIS_BASES = ["month", "cycle"] as const;
export type AnalysisBasis = (typeof ANALYSIS_BASES)[number];

export type NewCardInput = {
  label: string;
  issuer: CardIssuer;
  analysisBasis: AnalysisBasis;
  cycleStartDay: number | null;
};

export const CARD_ISSUER_LABELS: Record<CardIssuer, string> = {
  hyundai: "현대카드",
  shinhan: "신한카드",
  samsung: "삼성카드",
  kb: "KB국민카드",
  lotte: "롯데카드",
  hana: "하나카드",
  woori: "우리카드",
  bc: "BC카드",
  nh: "NH농협카드",
};
