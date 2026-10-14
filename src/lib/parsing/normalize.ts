import type { IsoDate } from "@/types/transaction";

export function normalizeMerchantKey(merchant: string): string {
  return merchant.normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();
}

export function parseWonAmount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?(?:\d{1,3}(?:,\d{3})+|\d+)$/.test(trimmed)) return null;

  const amount = Number(trimmed.replace(/,/g, ""));
  return Number.isSafeInteger(amount) ? amount : null;
}

// 같은 명세서도 받을 때마다 긴 가맹점명이 잘리는 길이가 달라서(공백 제외 16자 이상에서 잘림) 앞 12자만 쓴다.
// 앞 12자가 같은 다른 가맹점은 같은 날·금액이면 순번으로 나뉘어 둘 다 저장된다.
const CONTENT_MERCHANT_LENGTH = 12;

function contentMerchant(merchantKey: string): string {
  return Array.from(merchantKey.replace(/\s+/g, "")).slice(0, CONTENT_MERCHANT_LENGTH).join("");
}

export function contentEventKeys(
  rows: { date: IsoDate; merchantKey: string; amount: number }[],
): string[] {
  const occurrences = new Map<string, number>();

  return rows.map(({ date, merchantKey, amount }) => {
    const content = `${date}|${contentMerchant(merchantKey)}|${amount}`;
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return `${content}|${occurrence}`;
  });
}
