import "server-only";
import type { SummaryContent, SummaryInput } from "@/types/summary";

export type SummaryContentCheck =
  | ({ ok: true } & SummaryContent)
  | { ok: false; reason: "length" | "number" | "forbidden_phrase" | "markup" };
type TextReason = Exclude<SummaryContentCheck, { ok: true }>["reason"];

const FORBIDDEN_PHRASES = ["절감", "절약", "아낄", "부정 결제", "부정결제", "도용"];
const SUMMARY_LENGTH = { min: 20, max: 300 };
const TIP_LENGTH = { min: 10, max: 200 };
const TIP_COUNT = { min: 1, max: 3 };

function checkText(
  text: string, merchantNames: string[], length: { min: number; max: number },
): TextReason | null {
  const size = Array.from(text).length;
  if (size < length.min || size > length.max) return "length";

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
    return "markup";
  }

  const withoutAllowedDates = scrubbed
    .replace(/(?<![0-9])(1[0-2]|[1-9])월/g, "")
    .replace(/(?<![0-9])[0-9]{4}년/g, "");
  if (/[0-9０-９]/.test(withoutAllowedDates)) return "number";

  if (FORBIDDEN_PHRASES.some((phrase) => text.includes(phrase))) return "forbidden_phrase";
  return null;
}

export function checkSummaryContent(raw: SummaryContent, input: SummaryInput): SummaryContentCheck {
  const summary = raw.summary.trim();
  const tips = raw.tips.map((tip) => tip.trim());
  if (tips.length < TIP_COUNT.min || tips.length > TIP_COUNT.max) return { ok: false, reason: "length" };

  const merchantNames = [
    ...input.topMerchants.map(({ merchant }) => merchant),
    ...(input.plan === "pro" ? input.findings.map(({ merchant }) => merchant) : []),
  ].filter((merchant) => merchant.length > 0)
    .sort((left, right) => Array.from(right).length - Array.from(left).length);

  const reason = checkText(summary, merchantNames, SUMMARY_LENGTH)
    ?? tips.map((tip) => checkText(tip, merchantNames, TIP_LENGTH)).find((tipReason) => tipReason !== null)
    ?? null;
  return reason === null ? { ok: true, summary, tips } : { ok: false, reason };
}
