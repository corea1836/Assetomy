import "server-only";
import { describe, expect, it } from "vitest";
import type { CardSummaryInput, FreeSummaryInput, ProSummaryInput, SummaryDraft, SummaryInput } from "@/types/summary";
import { checkSummaryContent } from "./summary-text";

function freeInput(overrides: Partial<FreeSummaryInput> = {}): FreeSummaryInput {
  return {
    plan: "free",
    month: "2026-09",
    inProgress: false,
    period: { from: "2026-09-01", to: "2026-09-30" },
    total: 1000,
    transactionCount: 1,
    categories: [{ category: "식비", amount: 1000, ratio: 1, topMerchant: null, feedback: null }],
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

function cardInput(overrides: Partial<CardSummaryInput> = {}): CardSummaryInput {
  return {
    plan: "free",
    scope: "statement",
    period: { from: "2026-09-12", to: "2026-10-11" },
    inProgress: false,
    total: 120_000,
    transactionCount: 8,
    categories: [{ category: "식비", amount: 80_000, ratio: 0.67, topMerchant: null, feedback: null }],
    topMerchants: [{ merchant: "가게", category: "식비", amount: 40_000, count: 2 }],
    comparison: { previousTotal: 100_000, diff: 20_000, direction: "up" },
    comparisonSkipped: false,
    flow: null,
    ...overrides,
  } as CardSummaryInput;
}

const SUMMARY = "이번 달에는 식비 비중이 가장 크게 나타났어요.";
const TIP = "다음 달에는 식비 예산을 먼저 정해 보세요.";

function makeDraft(summary: string, tips: string[], input: SummaryInput | CardSummaryInput): SummaryDraft {
  return {
    summary,
    comparison: "",
    tips: tips.map((text) => {
      const category = input.categories.find(({ category: name }) => text.includes(name))?.category
        ?? input.categories[0]?.category;
      if (category === undefined) throw new Error("Expected a category for summary tip");
      return { category, text: text.includes(category) ? text : `${text} ${category}` };
    }),
  };
}

function check(summary: string, tips: string[] = [TIP], input: SummaryInput = freeInput()) {
  return checkSummaryContent(makeDraft(summary, tips, input), input);
}

describe("checkSummaryContent", () => {
  it("trims and returns a number-free summary and tips", () => {
    const tips = [`  ${TIP}  `, " 카드사 앱 승인 내역에서 같은 결제가 두 번 청구됐는지 확인해 보세요. "];
    expect(check(`  ${SUMMARY}  `, tips)).toEqual({
      ok: true, summary: SUMMARY, tips: [tips[0].trim(), `${tips[1].trim()} 식비`], tipCategories: ["food", "food"],
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
    expect(check(SUMMARY, ["식비 예산을 정해"])).toEqual({ ok: false, reason: "length" });
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

  it("checks tip count before either summary paragraph", () => {
    expect(checkSummaryContent({
      summary: "짧음",
      comparison: "",
      tips: Array.from({ length: 6 }, () => ({ category: "식비", text: TIP })),
    }, freeInput())).toEqual({ ok: false, reason: "length" });
  });

  it("accepts the SummaryInput union", () => {
    expect(check(SUMMARY, [TIP], proInput())).toMatchObject({ ok: true });
  });
});

describe("checkSummaryContent comparison and category contract", () => {
  const input = freeInput({ categories: [
    { category: "식비", amount: 700, ratio: 0.7, topMerchant: null, feedback: null },
    { category: "기타", amount: 300, ratio: 0.3, topMerchant: null, feedback: null },
  ] });

  it("stores a single paragraph when comparison is empty and joins nonempty paragraphs", () => {
    const base = { summary: SUMMARY, tips: [{ category: "식비", text: TIP }] };
    expect(checkSummaryContent({ ...base, comparison: "" }, input)).toMatchObject({ ok: true, summary: SUMMARY });
    expect(checkSummaryContent({ ...base, comparison: "지난달과 비교하면 지출이 늘었어요." }, input))
      .toMatchObject({ ok: true, summary: `${SUMMARY}\n\n지난달과 비교하면 지출이 늘었어요.` });
  });

  it("normalizes whitespace within paragraphs and tips", () => {
    expect(checkSummaryContent({
      summary: "  이번 달에는 식비 비중이\n\n 가장 크게 나타났어요.  ",
      comparison: "  지난달보다   지출이 줄었어요. ",
      tips: [{ category: "식비", text: " 식비 예산을\n   먼저 정해 보세요. " }],
    }, input)).toEqual({
      ok: true,
      summary: "이번 달에는 식비 비중이 가장 크게 나타났어요.\n\n지난달보다 지출이 줄었어요.",
      tips: ["식비 예산을 먼저 정해 보세요."],
      tipCategories: ["food"],
    });
  });

  it.each([
    ["numeric", "지난달보다 3원 줄었어요.", "number"],
    ["placeholder", "지난달보다 {unknown} 줄었어요.", "placeholder"],
    ["markdown", "**지난달**보다 지출이 줄었어요.", "markup"],
    ["forbidden phrase", "지난달보다 절감할 소비가 보여요.", "forbidden_phrase"],
    ["too short", "짧아요.", "length"],
    ["too long", "가".repeat(401), "length"],
  ] as const)("rejects an invalid comparison paragraph (%s)", (_name, comparison, reason) => {
    expect(checkSummaryContent({ summary: SUMMARY, comparison, tips: [{ category: "식비", text: TIP }] }, input))
      .toEqual({ ok: false, reason });
  });

  it("rejects an unknown category or a tip without its category name", () => {
    expect(checkSummaryContent({
      summary: SUMMARY, comparison: "", tips: [{ category: "교통", text: "식비 예산을 먼저 정해 보세요." }],
    }, input)).toEqual({ ok: false, reason: "tip_category" });
    expect(checkSummaryContent({
      summary: SUMMARY, comparison: "", tips: [{ category: "식비", text: "다음 달 예산을 먼저 정해 보세요." }],
    }, input)).toEqual({ ok: false, reason: "tip_category" });
  });

  it("trims category names, allows 기타, and preserves duplicate category ids in tip order", () => {
    expect(checkSummaryContent({
      summary: SUMMARY,
      comparison: "",
      tips: [
        { category: " 식비 ", text: "식비 예산을 먼저 정해 보세요." },
        { category: "기타", text: "기타 지출도 다음 달에 살펴보세요." },
        { category: "식비", text: "식비 지출을 주간 예산 안에서 살펴보세요." },
      ],
    }, input)).toMatchObject({ ok: true, tipCategories: ["food", "etc", "food"] });
  });
});

describe("checkSummaryContent placeholders", () => {
  const input = freeInput({
    total: 1_820_075,
    transactionCount: 78,
    categories: [
      { category: "문화·여가", amount: 691_600, ratio: 0.38, topMerchant: null, feedback: null },
      { category: "식비", amount: 436_800, ratio: 0.24, topMerchant: null, feedback: null },
      { category: "기타", amount: 0, ratio: null, topMerchant: null, feedback: null },
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
        "스타벅스 강남점에서 9건, 52,000원을 결제했어요. 한 주에 몇 번까지 갈지 정해 보세요. 문화·여가",
      "8월보다 ▲214,300원 늘었어요. 지난달 1,605,775원과 비교해 늘어난 카테고리를 살펴보세요. 문화·여가",
        "확인이 필요한 정기결제 2건, 후보 합계 43,000원을 카드사 앱에서 확인해 보세요. 문화·여가",
      ],
      tipCategories: ["culture", "culture", "culture"],
    });
  });

  it("fills the month-over-month difference with a direction marker", () => {
    const down = freeInput({
      monthOverMonth: { previousMonth: "2026-08", previousTotal: 3000, diff: -2000, direction: "down" },
    });
    expect(check("8월보다 {monthOverMonth.diff} 줄었어요. 좋은 흐름이에요.", [TIP], down))
      .toMatchObject({ ok: true, summary: "8월보다 ▼2,000원 줄었어요. 좋은 흐름이에요." });
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
      summary: "8월에는 1,000,000원을 썼고, 식비는 ▲100,000원 늘었어요.",
      tips: ["넷플릭스 17,000원 결제가 3개월 이어졌어요. 아직 보는 서비스인지 점검해 보세요. 식비"],
      tipCategories: ["food"],
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

  it("requires both the category and top merchant names for a category top merchant placeholder", () => {
    const withTopMerchant = freeInput({
      categories: [{
        category: "식비", amount: 10_000, ratio: 1,
        topMerchant: { merchant: "GS25 역삼점", amount: 10_000, count: 1 }, feedback: null,
      }],
    });
    expect(checkSummaryContent({
      summary: "식비에서 GS25 역삼점에 {categories[0].topMerchant.amount}을 썼어요. 다음 지출도 살펴봐요.",
      comparison: "",
      tips: [{ category: "식비", text: "식비에서 GS25 역삼점에 {categories[0].topMerchant.amount}을 써서 장보기 목록을 정해 보세요." }],
    }, withTopMerchant)).toMatchObject({ ok: true });
    expect(checkSummaryContent({
      summary: "식비에 {categories[0].topMerchant.amount}을 썼어요. 다음 지출도 살펴봐요.",
      comparison: "",
      tips: [{ category: "식비", text: "식비에서 {categories[0].topMerchant.amount}을 써서 장보기 목록을 정해 보세요." }],
    }, withTopMerchant)).toEqual({ ok: false, reason: "placeholder" });
  });

  it("rejects a top merchant placeholder when the category has no top merchant", () => {
    expect(checkSummaryContent({
      summary: "식비에 {categories[0].topMerchant.amount}을 썼어요. 다음 지출도 살펴봐요.",
      comparison: "",
      tips: [{ category: "식비", text: "식비 지출을 다음 달에도 이어서 살펴보세요." }],
    }, freeInput())).toEqual({ ok: false, reason: "placeholder" });
  });

  it("ignores digits in category top merchant names", () => {
    const input = freeInput({
      categories: [{
        category: "식비", amount: 10_000, ratio: 1,
        topMerchant: { merchant: "GS25 역삼점", amount: 10_000, count: 1 }, feedback: null,
      }],
    });
    expect(checkSummaryContent({
      summary: "식비에서는 GS25 역삼점이 눈에 띄었어요. 다음 지출도 살펴봐요.",
      comparison: "",
      tips: [{ category: "식비", text: "식비에서 GS25 역삼점 지출을 줄이기 어렵다면 필요한 물건을 미리 정해 보세요." }],
    }, input)).toMatchObject({ ok: true });
  });

  it("formats all summary and card difference placeholders with ▲, ▼, or 0원", () => {
    const differenceInputs: {
      path: string;
      makeInput: (diff: number) => SummaryInput | CardSummaryInput;
      name: string;
    }[] = [
      {
        path: "monthOverMonth.diff", name: "지난달",
        makeInput: (diff) => freeInput({
          monthOverMonth: { previousMonth: "2026-08", previousTotal: 1000, diff, direction: diff > 0 ? "up" : diff < 0 ? "down" : "same" },
        }),
      },
      {
        path: "comparison.diff", name: "지난 명세서",
        makeInput: (diff) => cardInput({
          comparison: { previousTotal: 1000, diff, direction: diff > 0 ? "up" : diff < 0 ? "down" : "same" },
        }),
      },
      {
        path: "trend.categoryChanges[0].diff", name: "식비",
        makeInput: (diff) => proInput({
          trend: { months: [], categoryChanges: [{ category: "식비", current: 2000, previous: 1000, diff }] },
        }),
      },
      {
        path: "categoryChanges[0].diff", name: "식비",
        makeInput: (diff) => cardInput({
          plan: "pro",
          categoryChanges: [{ category: "식비", current: 2000, previous: 1000, diff }],
        }),
      },
    ];
    for (const { path, name, makeInput } of differenceInputs) {
      for (const [diff, expected] of [[1200, "▲1,200원"], [-1200, "▼1,200원"], [0, "0원"]] as const) {
        const input = makeInput(diff);
        const sentence = `${name}는 {${path}} 달라졌어요. 이번 지출을 살펴봐요.`;
        expect(checkSummaryContent({
          summary: sentence,
          comparison: "",
          tips: [{ category: "식비", text: "식비 예산을 다음 기간에도 살펴볼 수 있게 먼저 정해 보세요." }],
        }, input)).toMatchObject({ ok: true, summary: sentence.replace(`{${path}}`, expected) });
      }
    }
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
      categories: [{ category: "식비", amount: 80_000, ratio: 0.67, topMerchant: null, feedback: null }],
      topMerchants: [{ merchant: "가게", category: "식비", amount: 40_000, count: 2 }],
      comparison: { previousTotal: 100_000, diff: 20_000, direction: "up" as const },
      comparisonSkipped: false,
      flow: null,
    };
    return { plan: "free", ...shared, ...overrides } as CardSummaryInput;
  }

  it("fills card period, comparison, and category change placeholders", () => {
    const input = cardInput({
      plan: "pro",
      categoryChanges: [{ category: "식비", current: 80_000, previous: 60_000, diff: 20_000 }],
    });
    expect(checkSummaryContent(makeDraft(
      "{period} 동안 {transactionCount}, {total}을 썼어요. 지난 명세서의 {comparison.previousTotal}보다 {comparison.diff} 늘었고 식비는 {categoryChanges[0].diff} 더 썼어요.",
      ["식비 예산을 정하고 다음 명세서까지 지출을 살펴보세요."], input,
    ), input)).toEqual({
      ok: true,
      summary: "9월 12일~10월 11일 동안 8건, 120,000원을 썼어요. 지난 명세서의 100,000원보다 ▲20,000원 늘었고 식비는 ▲20,000원 더 썼어요.",
      tips: ["식비 예산을 정하고 다음 명세서까지 지출을 살펴보세요."],
      tipCategories: ["food"],
    });
  });

  it("fills a monthly card comparison difference with a direction marker", () => {
    const input = cardInput({
      scope: "month",
      period: { from: "2026-09-01", to: "2026-09-30" },
      comparison: { previousTotal: 150_000, diff: -30_000, direction: "down" },
    });
    expect(checkSummaryContent(makeDraft(
      "이번 달 {period} 동안 {transactionCount}, {total}을 썼어요. 지난달 {comparison.previousTotal}보다 {comparison.diff} 줄었어요.",
      ["다음 달 예산을 정해 이번 달 지출 흐름을 이어서 살펴보세요."], input,
    ), input)).toMatchObject({
      ok: true,
      summary: "이번 달 9월 1일~9월 30일 동안 8건, 120,000원을 썼어요. 지난달 150,000원보다 ▼30,000원 줄었어요.",
    });
  });

  it("requires the category name next to a category change placeholder", () => {
    const input = cardInput({
      plan: "pro",
      categoryChanges: [{ category: "식비", current: 80_000, previous: 60_000, diff: 20_000 }],
    });
    expect(checkSummaryContent(makeDraft(
      "이번 명세서 지출은 {categoryChanges[0].diff} 달라졌어요. 확인해 보세요.",
      ["식비 예산을 정하고 다음 명세서까지 지출을 살펴보세요."], input,
    ), input)).toEqual({ ok: false, reason: "placeholder" });
  });

  it("rejects Pro-only category change placeholders for Free card input", () => {
    const input = cardInput();
    expect(checkSummaryContent(makeDraft(
      "이번 달 식비는 {categoryChanges[0].diff} 달라졌어요. 지출을 살펴봐요.",
      ["식비 예산을 정하고 다음 달 지출을 살펴보세요."], input,
    ), input)).toEqual({ ok: false, reason: "placeholder" });
  });

  it("requires the named month for a flow period placeholder", () => {
    const input = cardInput({
      flow: {
        direction: "rising",
        periods: [
          { month: "2026-07", total: 100_000 },
          { month: "2026-08", total: 120_000 },
          { month: "2026-09", total: 140_000 },
        ],
      },
    });
    expect(checkSummaryContent({
      summary: "흐름은 {flow.periods[1].total}으로 보였어요. 다음 기간도 살펴봐요.",
      comparison: "",
      tips: [{ category: "식비", text: "식비 예산을 다음 기간에도 살펴볼 수 있게 먼저 정해 보세요." }],
    }, input)).toEqual({ ok: false, reason: "placeholder" });
    expect(checkSummaryContent({
      summary: "8월에는 {flow.periods[1].total}을 썼어요. 다음 기간도 살펴봐요.",
      comparison: "",
      tips: [{ category: "식비", text: "식비 예산을 다음 기간에도 살펴볼 수 있게 먼저 정해 보세요." }],
    }, input)).toMatchObject({ ok: true, summary: "8월에는 120,000원을 썼어요. 다음 기간도 살펴봐요." });
  });

  it("allows Pro category flow placeholders only with category and period names", () => {
    const flow = {
      direction: "rising" as const,
      periods: [
        { month: "2026-07" as const, total: 100_000 },
        { month: "2026-08" as const, total: 120_000 },
        { month: "2026-09" as const, total: 140_000 },
      ],
      categories: [{
        category: "식비",
        direction: "rising" as const,
        periods: [
          { month: "2026-07" as const, amount: 10_000 },
          { month: "2026-08" as const, amount: 12_000 },
          { month: "2026-09" as const, amount: 14_000 },
        ],
      }],
    };
    const pro = cardInput({ plan: "pro", flow, categoryChanges: null });
    expect(checkSummaryContent({
      summary: "식비는 9월에 {flow.categories[0].periods[2].amount}을 썼어요. 다음 기간도 살펴봐요.",
      comparison: "",
      tips: [{ category: "식비", text: "식비 예산을 다음 기간에도 살펴볼 수 있게 먼저 정해 보세요." }],
    }, pro)).toMatchObject({ ok: true, summary: "식비는 9월에 14,000원을 썼어요. 다음 기간도 살펴봐요." });
    expect(checkSummaryContent({
      summary: "9월에 {flow.categories[0].periods[2].amount}을 썼어요. 다음 기간도 살펴봐요.",
      comparison: "",
      tips: [{ category: "식비", text: "식비 예산을 다음 기간에도 살펴볼 수 있게 먼저 정해 보세요." }],
    }, pro)).toEqual({ ok: false, reason: "placeholder" });
    expect(checkSummaryContent({
      summary: "식비는 {flow.categories[0].periods[2].amount}을 썼어요. 다음 기간도 살펴봐요.",
      comparison: "",
      tips: [{ category: "식비", text: "식비 예산을 다음 기간에도 살펴볼 수 있게 먼저 정해 보세요." }],
    }, pro)).toEqual({ ok: false, reason: "placeholder" });
    expect(checkSummaryContent({
      summary: "식비는 9월에 {flow.categories[0].periods[0].amount}을 썼어요. 다음 기간도 살펴봐요.",
      comparison: "",
      tips: [{ category: "식비", text: "식비 예산을 다음 기간에도 살펴볼 수 있게 먼저 정해 보세요." }],
    }, cardInput({ plan: "free", flow: { direction: "rising", periods: flow.periods } })))
      .toEqual({ ok: false, reason: "placeholder" });
  });
});
