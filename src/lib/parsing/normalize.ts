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

export function contentEventKeys(
  rows: { date: IsoDate; merchantKey: string; amount: number }[],
): string[] {
  const occurrences = new Map<string, number>();

  return rows.map(({ date, merchantKey, amount }) => {
    const content = `${date}|${merchantKey}|${amount}`;
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return `${content}|${occurrence}`;
  });
}
