import { CARD_ISSUER_LABELS, type CardIssuer } from "@/types/card";
import type { CardOption } from "@/types/upload";

export function nextCardLabel(issuer: CardIssuer, cards: Pick<CardOption, "issuer" | "label">[]): string {
  const base = CARD_ISSUER_LABELS[issuer];
  const usedLabels = new Set(cards.map((card) => card.label));
  let number = cards.filter((card) => card.issuer === issuer).length + 1;
  let label = `${base} ${number}`;
  while (usedLabels.has(label)) {
    number += 1;
    label = `${base} ${number}`;
  }
  return label;
}
