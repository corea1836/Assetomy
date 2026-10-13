import "server-only";
import { describe, expect, it } from "vitest";
import type { FreeSummaryInput, ProSummaryInput, SummaryInput } from "@/types/summary";
import { checkSummaryContent } from "./summary-text";

function freeInput(overrides: Partial<FreeSummaryInput> = {}): FreeSummaryInput {
  return {
    plan: "free",
    month: "2026-09",
    inProgress: false,
    period: { from: "2026-09-01", to: "2026-09-30" },
    total: 1000,
    transactionCount: 1,
    categories: [],
    topMerchants: [],
    monthOverMonth: null,
    candidates: {
      recurring: { count: 0, amount: 0 },
      duplicate: { count: 0, amount: 0 },
      large: { count: 0, amount: 0 },
      candidateTotal: 0,
    },
    ...overrides,
  };
}

function proInput(overrides: Partial<ProSummaryInput> = {}): ProSummaryInput {
  return {
    ...freeInput(),
    plan: "pro",
    findings: [],
    trend: null,
    ...overrides,
  };
}

const SUMMARY = "이번 달에는 식비 비중이 가장 크게 나타났어요.";
const TIP = "다음 달에는 식비 예산을 먼저 정해 보세요.";

function check(summary: string, tips: string[] = [TIP], input: SummaryInput = freeInput()) {
  return checkSummaryContent({ summary, tips }, input);
}

describe("checkSummaryContent", () => {
  it("trims and returns a number-free summary and tips", () => {
    const tips = [`  ${TIP}  `, " 카드사 앱 승인 내역에서 같은 결제가 두 번 청구됐는지 확인해 보세요. "];
    expect(check(`  ${SUMMARY}  `, tips)).toEqual({
      ok: true, summary: SUMMARY, tips: tips.map((tip) => tip.trim()),
    });
  });

  it.each(["1,820,075원", "3건", "20%", "３"])("rejects numeric text in the summary: %s", (numericText) => {
    expect(check(`이번 달 지출 흐름을 보면 ${numericText} 정도가 보여요.`)).toEqual({ ok: false, reason: "number" });
  });

  it.each(["1,820,075원", "3건", "20%", "３"])("rejects numeric text in a tip: %s", (numericText) => {
    expect(check(SUMMARY, [TIP, `식비를 ${numericText} 줄이도록 예산을 정해 보세요.`]))
      .toEqual({ ok: false, reason: "number" });
  });

  it.each(["9월", "12월", "2026년"])("allows a month or year: %s", (dateText) => {
    expect(check(`이번 ${dateText} 소비는 식비 비중이 가장 크게 보여요.`, [`${dateText} 예산을 먼저 정해 보세요.`]))
      .toMatchObject({ ok: true });
  });

  it("rejects a month outside the allowed range", () => {
    expect(check("이번 13월 소비는 식비 비중이 가장 크게 보여요.")).toEqual({ ok: false, reason: "number" });
  });

  it("ignores numbers that occur only inside input merchant names", () => {
    const input = freeInput({
      topMerchants: [{ merchant: "GS25 역삼점", category: "마트·생활", amount: 1000, count: 1 }],
    });
    expect(check("GS25 역삼점 결제가 이번 달 생활 지출에서 눈에 띄어요.", ["GS25 역삼점 결제가 꼭 필요했는지 살펴보세요."], input))
      .toMatchObject({ ok: true });
  });

  it("ignores numbers in Pro finding merchant names but rejects them elsewhere", () => {
    const input = proInput({
      findings: [{ kind: "large", merchant: "7번가피자", category: "식비", amount: 1000, transactionCount: 1, seriesMonthCount: null }],
    });
    expect(check(SUMMARY, ["7번가피자 결제가 정상 지출인지 카드사 앱에서 확인해 보세요."], input))
      .toMatchObject({ ok: true });
    expect(check(SUMMARY, ["7번가피자 결제를 2번 더 살펴보세요."], input))
      .toEqual({ ok: false, reason: "number" });
  });

  it("removes longer merchant names before names they contain", () => {
    const input = freeInput({
      topMerchants: [
        { merchant: "GS25", category: "마트·생활", amount: 1000, count: 1 },
        { merchant: "GS25 역삼점", category: "마트·생활", amount: 1000, count: 1 },
      ],
    });
    expect(check("GS25 역삼점에서 생활 지출이 가장 많았어요.", [TIP], input)).toMatchObject({ ok: true });
  });

  it.each(["**굵은 제목**", "# 제목", "`코드`", "- 목록 항목"])("rejects markdown in the summary: %s", (markup) => {
    expect(check(`${markup}\n${SUMMARY}`)).toEqual({ ok: false, reason: "markup" });
  });

  it.each(["- ", "* ", "• "])("rejects a list marker at the start of a tip: %s", (marker) => {
    expect(check(SUMMARY, [`${marker}${TIP}`])).toEqual({ ok: false, reason: "markup" });
  });

  it("does not treat a hash inside a merchant name as markup", () => {
    const input = freeInput({
      topMerchants: [{ merchant: "샵#25", category: "쇼핑", amount: 1000, count: 1 }],
    });
    expect(check("샵#25 결제가 이번 달 쇼핑 지출에서 눈에 띄어요.", ["샵#25 결제가 꼭 필요했는지 살펴보세요."], input))
      .toMatchObject({ ok: true });
  });

  it.each(["절감", "절약", "아낄", "부정 결제", "부정결제", "도용"])("rejects a forbidden phrase in the summary or a tip: %s", (phrase) => {
    expect(check(`이번 달에는 ${phrase} 수 있는 소비가 보여요.`)).toEqual({ ok: false, reason: "forbidden_phrase" });
    expect(check(SUMMARY, [`식비에서 ${phrase} 수 있는지 살펴보세요.`])).toEqual({ ok: false, reason: "forbidden_phrase" });
  });

  it("rejects summaries shorter than 20 or longer than 300 characters", () => {
    expect(check("가".repeat(19))).toEqual({ ok: false, reason: "length" });
    expect(check("가".repeat(301))).toEqual({ ok: false, reason: "length" });
    expect(check("가".repeat(20))).toMatchObject({ ok: true });
  });

  it("rejects tips shorter than 10 or longer than 200 characters", () => {
    expect(check(SUMMARY, ["가".repeat(9)])).toEqual({ ok: false, reason: "length" });
    expect(check(SUMMARY, ["가".repeat(201)])).toEqual({ ok: false, reason: "length" });
    expect(check(SUMMARY, ["가".repeat(10)])).toMatchObject({ ok: true });
  });

  it("requires one to three tips", () => {
    expect(check(SUMMARY, [])).toEqual({ ok: false, reason: "length" });
    expect(check(SUMMARY, [TIP, TIP, TIP, TIP])).toEqual({ ok: false, reason: "length" });
    expect(check(SUMMARY, [TIP, TIP, TIP])).toMatchObject({ ok: true });
  });

  it("accepts the SummaryInput union", () => {
    expect(check(SUMMARY, [TIP], proInput())).toMatchObject({ ok: true });
  });
});
