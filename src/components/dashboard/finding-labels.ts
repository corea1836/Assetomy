import type { FindingKind } from "@/types/dashboard";

export const FINDING_KIND_LABELS: Record<FindingKind, string> = {
  recurring: "정기결제로 보여요",
  duplicate: "중복 결제 의심",
  large: "고액 결제",
};
