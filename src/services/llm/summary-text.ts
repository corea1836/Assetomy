import "server-only";
import { formatDate, formatRatio, formatWon } from "@/lib/format";
import type { CardSummaryInput, SummaryContent, SummaryInput } from "@/types/summary";

export type SummaryContentCheck =
  | ({ ok: true } & SummaryContent)
  | { ok: false; reason: "length" | "number" | "forbidden_phrase" | "markup" | "placeholder" };
type TextReason = Exclude<SummaryContentCheck, { ok: true }>["reason"];

const FORBIDDEN_PHRASES = ["절감", "아낄", "부정 결제", "부정결제", "도용"];
const SUMMARY_LENGTH = { min: 20, max: 500 };
const TIP_LENGTH = { min: 10, max: 300 };
const TIP_COUNT = { min: 1, max: 5 };

const PLACEHOLDER = /\{([^{}]*)\}/g;
const PATH_SEGMENT = /^([A-Za-z]+)(?:\[(0|[1-9][0-9]*)\])?$/;

// 숫자 필드 이름으로 단위를 정한다. 전월 차이는 방향을 문장으로 말하므로 크기만 채운다.
const FIELD_FORMATS: Record<string, (value: number) => string> = {
  total: formatWon,
  amount: formatWon,
  previousTotal: formatWon,
  candidateTotal: formatWon,
  current: formatWon,
  previous: formatWon,
  diff: (value) => formatWon(Math.abs(value)),
  ratio: formatRatio,
  count: (value) => `${value}건`,
  transactionCount: (value) => `${value}건`,
  seriesMonthCount: (value) => `${value}개월`,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 배열 항목의 값은 같은 요약·팁에 그 항목 이름이 있어야 쓸 수 있다.
function itemName(item: Record<string, unknown>): string | null {
  if (typeof item.merchant === "string") return item.merchant;
  if (typeof item.category === "string") return item.category;
  if (typeof item.month === "string") return `${Number(item.month.slice(5))}월`;
  return null;
}

type SummaryCheckInput = SummaryInput | CardSummaryInput;

function resolvePlaceholder(path: string, input: SummaryCheckInput): { value: string; names: string[] } | null {
  if (path === "period") {
    return { value: `${formatDate(input.period.from)}~${formatDate(input.period.to)}`, names: [] };
  }

  let node: unknown = input;
  let field = "";
  const names: string[] = [];
  for (const segment of path.split(".")) {
    const match = PATH_SEGMENT.exec(segment);
    if (match === null || !isRecord(node) || !Object.hasOwn(node, match[1])) return null;
    field = match[1];
    node = node[field];
    if (match[2] !== undefined) {
      if (!Array.isArray(node)) return null;
      node = node[Number(match[2])];
      if (!isRecord(node)) return null;
      const name = itemName(node);
      if (name === null) return null;
      names.push(name);
    }
  }

  const format = Object.hasOwn(FIELD_FORMATS, field) ? FIELD_FORMATS[field] : undefined;
  if (format === undefined || typeof node !== "number" || !Number.isFinite(node)) return null;
  return { value: format(node), names };
}

function renderText(
  text: string,
  input: SummaryCheckInput,
  merchantNames: string[],
  length: { min: number; max: number },
): { text: string } | { reason: TextReason } {
  const values = new Map<string, string>();
  for (const [, path] of text.matchAll(PLACEHOLDER)) {
    const resolved = resolvePlaceholder(path, input);
    if (resolved === null || resolved.names.some((name) => !text.includes(name))) {
      return { reason: "placeholder" };
    }
    values.set(path, resolved.value);
  }

  let scrubbed = text.replace(PLACEHOLDER, "");
  for (const merchant of merchantNames) {
    scrubbed = scrubbed.split(merchant).join("");
  }
  if (/[{}]/.test(scrubbed)) return { reason: "placeholder" };

  const rendered = text.replace(PLACEHOLDER, (_placeholder, path: string) => values.get(path) ?? "");
  const size = Array.from(rendered).length;
  if (size < length.min || size > length.max) return { reason: "length" };

  if (
    scrubbed.includes("**")
    || scrubbed.includes("#")
    || scrubbed.includes("`")
    || /^(?:- |\* |• )/m.test(scrubbed)
  ) {
    return { reason: "markup" };
  }

  const withoutAllowedDates = scrubbed
    .replace(/(?<![0-9])(1[0-2]|[1-9])월/g, "")
    .replace(/(?<![0-9])[0-9]{4}년/g, "");
  if (/[0-9０-９]/.test(withoutAllowedDates)) return { reason: "number" };

  if (FORBIDDEN_PHRASES.some((phrase) => text.includes(phrase))) return { reason: "forbidden_phrase" };
  return { text: rendered };
}

// 검증을 통과하면 자리표시자를 입력 값으로 채운 요약·팁을 돌려준다.
export function checkSummaryContent(raw: SummaryContent, input: SummaryInput | CardSummaryInput): SummaryContentCheck {
  const tips = raw.tips.map((tip) => tip.trim());
  if (tips.length < TIP_COUNT.min || tips.length > TIP_COUNT.max) return { ok: false, reason: "length" };

  const merchantNames = [
    ...input.topMerchants.map(({ merchant }) => merchant),
    ...("findings" in input ? input.findings.map(({ merchant }) => merchant) : []),
  ].filter((merchant) => merchant.length > 0)
    .sort((left, right) => Array.from(right).length - Array.from(left).length);

  const summary = renderText(raw.summary.trim(), input, merchantNames, SUMMARY_LENGTH);
  if ("reason" in summary) return { ok: false, reason: summary.reason };

  const renderedTips: string[] = [];
  for (const tip of tips) {
    const rendered = renderText(tip, input, merchantNames, TIP_LENGTH);
    if ("reason" in rendered) return { ok: false, reason: rendered.reason };
    renderedTips.push(rendered.text);
  }
  return { ok: true, summary: summary.text, tips: renderedTips };
}
