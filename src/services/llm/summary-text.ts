import "server-only";
import type { SummaryInput } from "@/types/summary";

export type SummaryTextCheck =
  | { ok: true; text: string }
  | { ok: false; reason: "length" | "number" | "forbidden_phrase" | "markup" };

const FORBIDDEN_PHRASES = ["절감", "절약", "아낄", "부정 결제", "부정결제", "도용"];

export function checkSummaryText(raw: string, input: SummaryInput): SummaryTextCheck {
  const text = raw.trim();
  const length = Array.from(text).length;
  if (length < 30 || length > 600) return { ok: false, reason: "length" };

  const merchantNames = [
    ...input.topMerchants.map(({ merchant }) => merchant),
    ...(input.plan === "pro" ? input.findings.map(({ merchant }) => merchant) : []),
  ].filter((merchant) => merchant.length > 0)
    .sort((left, right) => Array.from(right).length - Array.from(left).length);

  let scrubbed = text;
  for (const merchant of merchantNames) {
    scrubbed = scrubbed.split(merchant).join("");
  }

  if (
    scrubbed.includes("**")
    || scrubbed.includes("#")
    || scrubbed.includes("`")
    || /^(?:- |\* |• )/m.test(scrubbed)
  ) {
    return { ok: false, reason: "markup" };
  }

  const withoutAllowedDates = scrubbed
    .replace(/(?<![0-9])(1[0-2]|[1-9])월/g, "")
    .replace(/(?<![0-9])[0-9]{4}년/g, "");
  if (/[0-9０-９]/.test(withoutAllowedDates)) {
    return { ok: false, reason: "number" };
  }

  if (FORBIDDEN_PHRASES.some((phrase) => text.includes(phrase))) {
    return { ok: false, reason: "forbidden_phrase" };
  }

  return { ok: true, text };
}
