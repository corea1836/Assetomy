import "server-only";
import { describe, expect, it } from "vitest";
import type { CardSummaryInput, FreeSummaryInput, ProSummaryInput, SummaryInput } from "@/types/summary";
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
    partialMonth: null,
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

  it.each(["절감", "아낄", "부정 결제", "부정결제", "도용"])("rejects a forbidden phrase in the summary or a tip: %s", (phrase) => {
    expect(check(`이번 달에는 ${phrase} 수 있는 소비가 보여요.`)).toEqual({ ok: false, reason: "forbidden_phrase" });
    expect(check(SUMMARY, [`식비에서 ${phrase} 수 있는지 살펴보세요.`])).toEqual({ ok: false, reason: "forbidden_phrase" });
  });

  it("allows saving advice without an amount", () => {
    expect(check(SUMMARY, ["식비 예산을 먼저 정해 두면 절약하기 쉬워요."])).toMatchObject({ ok: true });
  });

  it("rejects summaries shorter than 20 or longer than 500 characters", () => {
    expect(check("가".repeat(19))).toEqual({ ok: false, reason: "length" });
    expect(check("가".repeat(501))).toEqual({ ok: false, reason: "length" });
    expect(check("가".repeat(20))).toMatchObject({ ok: true });
  });

  it("rejects tips shorter than 10 or longer than 300 characters", () => {
    expect(check(SUMMARY, ["가".repeat(9)])).toEqual({ ok: false, reason: "length" });
    expect(check(SUMMARY, ["가".repeat(301)])).toEqual({ ok: false, reason: "length" });
    expect(check(SUMMARY, ["가".repeat(10)])).toMatchObject({ ok: true });
  });

  it("measures length after filling placeholders", () => {
    const input = freeInput({ total: 1_820_075 });
    expect(check(`${"가".repeat(490)}{total}`, [TIP], input)).toMatchObject({ ok: true });
    expect(check(`${"가".repeat(491)}{total}`, [TIP], input)).toEqual({ ok: false, reason: "length" });
  });

  it("requires one to five tips", () => {
    expect(check(SUMMARY, [])).toEqual({ ok: false, reason: "length" });
    expect(check(SUMMARY, [TIP, TIP, TIP, TIP, TIP, TIP])).toEqual({ ok: false, reason: "length" });
    expect(check(SUMMARY, [TIP, TIP, TIP, TIP, TIP])).toMatchObject({ ok: true });
  });

  it("accepts the SummaryInput union", () => {
    expect(check(SUMMARY, [TIP], proInput())).toMatchObject({ ok: true });
  });
});

describe("checkSummaryContent placeholders", () => {
  const input = freeInput({
    total: 1_820_075,
    transactionCount: 78,
    categories: [
      { category: "문화·여가", amount: 691_600, ratio: 0.38 },
      { category: "식비", amount: 436_800, ratio: 0.24 },
      { category: "기타", amount: 0, ratio: null },
    ],
    topMerchants: [{ merchant: "스타벅스 강남점", category: "카페·간식", amount: 52_000, count: 9 }],
    monthOverMonth: { previousMonth: "2026-08", previousTotal: 1_605_775, diff: 214_300, direction: "up" },
    candidates: {
      recurring: { count: 2, amount: 31_000 },
      duplicate: { count: 1, amount: 12_000 },
      large: { count: 0, amount: 0 },
      candidateTotal: 43_000,
    },
  });

  it("fills placeholders with code-formatted input values", () => {
    expect(check(
      "{period} 동안 {transactionCount}, {total}을 썼어요. 문화·여가가 {categories[0].ratio}({categories[0].amount})로 가장 컸어요.",
      [
        "스타벅스 강남점에서 {topMerchants[0].count}, {topMerchants[0].amount}을 결제했어요. 한 주에 몇 번까지 갈지 정해 보세요.",
        "8월보다 {monthOverMonth.diff} 늘었어요. 지난달 {monthOverMonth.previousTotal}과 비교해 늘어난 카테고리를 살펴보세요.",
        "확인이 필요한 정기결제 {candidates.recurring.count}, 후보 합계 {candidates.candidateTotal}을 카드사 앱에서 확인해 보세요.",
      ],
      input,
    )).toEqual({
      ok: true,
      summary: "9월 1일~9월 30일 동안 78건, 1,820,075원을 썼어요. 문화·여가가 38%(691,600원)로 가장 컸어요.",
      tips: [
        "스타벅스 강남점에서 9건, 52,000원을 결제했어요. 한 주에 몇 번까지 갈지 정해 보세요.",
        "8월보다 214,300원 늘었어요. 지난달 1,605,775원과 비교해 늘어난 카테고리를 살펴보세요.",
        "확인이 필요한 정기결제 2건, 후보 합계 43,000원을 카드사 앱에서 확인해 보세요.",
      ],
    });
  });

  it("fills the month-over-month difference without a sign", () => {
    const down = freeInput({
      monthOverMonth: { previousMonth: "2026-08", previousTotal: 3000, diff: -2000, direction: "down" },
    });
    expect(check("8월보다 {monthOverMonth.diff} 줄었어요. 좋은 흐름이에요.", [TIP], down))
      .toMatchObject({ ok: true, summary: "8월보다 2,000원 줄었어요. 좋은 흐름이에요." });
  });

  it("fills Pro finding and trend placeholders", () => {
    const pro = proInput({
      findings: [{ kind: "recurring", merchant: "넷플릭스", category: "구독·정기결제", amount: 17_000, transactionCount: 1, seriesMonthCount: 3 }],
      trend: {
        months: [
          { month: "2026-07", total: 900_000, inProgress: false },
          { month: "2026-08", total: 1_000_000, inProgress: false },
        ],
        categoryChanges: [{ category: "식비", current: 400_000, previous: 300_000, diff: 100_000 }],
      },
    });
    expect(check(
      "8월에는 {trend.months[1].total}을 썼고, 식비는 {trend.categoryChanges[0].diff} 늘었어요.",
      ["넷플릭스 {findings[0].amount} 결제가 {findings[0].seriesMonthCount} 이어졌어요. 아직 보는 서비스인지 점검해 보세요."],
      pro,
    )).toEqual({
      ok: true,
      summary: "8월에는 1,000,000원을 썼고, 식비는 100,000원 늘었어요.",
      tips: ["넷플릭스 17,000원 결제가 3개월 이어졌어요. 아직 보는 서비스인지 점검해 보세요."],
    });
  });

  it.each([
    "{unknown}",
    "{categories[3].amount}",
    "{categories[0].category}",
    "{categories[2].ratio}",
    "{categories.0.amount}",
    "{ total }",
    "{constructor}",
    "{month}",
    "{inProgress}",
    "{period.from}",
    "{monthOverMonth.direction}",
    "{monthOverMonth.previousMonth}",
    "{findings[0].amount}",
    "{}",
  ])("rejects a placeholder that is not a numeric input field: %s", (placeholder) => {
    expect(check(`문화·여가 식비 기타 스타벅스 강남점 지출은 ${placeholder}이에요.`, [TIP], input))
      .toEqual({ ok: false, reason: "placeholder" });
    expect(check(SUMMARY, [`문화·여가 식비 기타 지출은 ${placeholder}이에요. 살펴보세요.`], input))
      .toEqual({ ok: false, reason: "placeholder" });
  });

  it("rejects month-over-month placeholders when there is no previous month", () => {
    expect(check("지난달보다 {monthOverMonth.diff} 늘었어요.", [TIP], freeInput()))
      .toEqual({ ok: false, reason: "placeholder" });
  });

  it("rejects an array placeholder when its item name is not in the same text", () => {
    expect(check("문화·여가가 {categories[1].ratio}로 가장 컸어요.", [TIP], input))
      .toEqual({ ok: false, reason: "placeholder" });
    expect(check(SUMMARY, ["{categories[1].amount}을 쓴 카테고리의 예산을 정해 보세요."], input))
      .toEqual({ ok: false, reason: "placeholder" });
    expect(check(SUMMARY, ["7월에는 {trend.months[1].total}을 썼어요. 살펴보세요."], proInput({
      trend: { months: [{ month: "2026-07", total: 1, inProgress: false }, { month: "2026-08", total: 2, inProgress: false }], categoryChanges: null },
    }))).toEqual({ ok: false, reason: "placeholder" });
  });

  it.each(["{total", "total}", "{{total}}"])("rejects unbalanced braces: %s", (text) => {
    expect(check(`이번 달 총지출은 ${text}이에요.`, [TIP], input)).toEqual({ ok: false, reason: "placeholder" });
  });

  it("still rejects digits written outside placeholders", () => {
    expect(check("{period} 동안 78건, {total}을 썼어요.", [TIP], input)).toEqual({ ok: false, reason: "number" });
  });
});

describe("checkSummaryContent card placeholders", () => {
  function cardInput(overrides: Partial<CardSummaryInput> = {}): CardSummaryInput {
    const shared = {
      scope: "statement" as const,
      period: { from: "2026-09-12", to: "2026-10-11" },
      inProgress: false,
      total: 120_000,
      transactionCount: 8,
      categories: [{ category: "식비", amount: 80_000, ratio: 0.67 }],
      topMerchants: [{ merchant: "가게", category: "식비", amount: 40_000, count: 2 }],
      comparison: { previousTotal: 100_000, diff: 20_000, direction: "up" as const },
      comparisonSkipped: false,
    };
    return { plan: "free", ...shared, ...overrides } as CardSummaryInput;
  }

  it("fills card period, comparison, and category change placeholders", () => {
    const input = cardInput({
      plan: "pro",
      categoryChanges: [{ category: "식비", current: 80_000, previous: 60_000, diff: 20_000 }],
    });
    expect(checkSummaryContent({
      summary: "{period} 동안 {transactionCount}, {total}을 썼어요. 지난 명세서의 {comparison.previousTotal}보다 {comparison.diff} 늘었고 식비는 {categoryChanges[0].diff} 더 썼어요.",
      tips: ["식비 예산을 정하고 다음 명세서까지 지출을 살펴보세요."],
    }, input)).toEqual({
      ok: true,
      summary: "9월 12일~10월 11일 동안 8건, 120,000원을 썼어요. 지난 명세서의 100,000원보다 20,000원 늘었고 식비는 20,000원 더 썼어요.",
      tips: ["식비 예산을 정하고 다음 명세서까지 지출을 살펴보세요."],
    });
  });

  it("fills a monthly card comparison difference without a sign", () => {
    const input = cardInput({
      scope: "month",
      period: { from: "2026-09-01", to: "2026-09-30" },
      comparison: { previousTotal: 150_000, diff: -30_000, direction: "down" },
    });
    expect(checkSummaryContent({
      summary: "이번 달 {period} 동안 {transactionCount}, {total}을 썼어요. 지난달 {comparison.previousTotal}보다 {comparison.diff} 줄었어요.",
      tips: ["다음 달 예산을 정해 이번 달 지출 흐름을 이어서 살펴보세요."],
    }, input)).toMatchObject({
      ok: true,
      summary: "이번 달 9월 1일~9월 30일 동안 8건, 120,000원을 썼어요. 지난달 150,000원보다 30,000원 줄었어요.",
    });
  });

  it("requires the category name next to a category change placeholder", () => {
    const input = cardInput({
      plan: "pro",
      categoryChanges: [{ category: "식비", current: 80_000, previous: 60_000, diff: 20_000 }],
    });
    expect(checkSummaryContent({
      summary: "이번 명세서 지출은 {categoryChanges[0].diff} 달라졌어요. 확인해 보세요.",
      tips: ["식비 예산을 정하고 다음 명세서까지 지출을 살펴보세요."],
    }, input)).toEqual({ ok: false, reason: "placeholder" });
  });

  it("rejects Pro-only category change placeholders for Free card input", () => {
    expect(checkSummaryContent({
      summary: "이번 달 식비는 {categoryChanges[0].diff} 달라졌어요. 지출을 살펴봐요.",
      tips: ["식비 예산을 정하고 다음 달 지출을 살펴보세요."],
    }, cardInput())).toEqual({ ok: false, reason: "placeholder" });
  });
});
