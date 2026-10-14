import "server-only";
import { describe, expect, it } from "vitest";
import type { CardSummaryInput, FreeSummaryInput, ProSummaryInput, SummaryCategory } from "@/types/summary";
import { createMockCardSummarizer, createMockSummarizer, MOCK_CARD_SUMMARY_MODEL, MOCK_SUMMARY_MODEL } from "./mock-summarizer";

type CategoryFixture = Pick<SummaryCategory, "category" | "amount" | "ratio"> & Partial<Pick<SummaryCategory, "topMerchant" | "feedback">>;

function categories(values: CategoryFixture[] = [
  { category: "식비", amount: 1000, ratio: 0.5 },
  { category: "카페·간식", amount: 500, ratio: 0.25 },
  { category: "기타", amount: 500, ratio: 0.25 },
]): SummaryCategory[] {
  return values.map((value) => ({ ...value, topMerchant: value.topMerchant ?? null, feedback: value.feedback ?? null }));
}

function monthlyInputs() {
  const shared = {
    month: "2026-09" as const, inProgress: false,
    period: { from: "2026-09-01", to: "2026-09-30" }, total: 1000, transactionCount: 1,
    categories: categories(), topMerchants: [], monthOverMonth: null, partialMonth: null,
    candidates: {
      recurring: { count: 0, amount: 0 }, duplicate: { count: 0, amount: 0 },
      large: { count: 0, amount: 0 }, candidateTotal: 0,
    },
  };
  return {
    free: { ...shared, plan: "free" } as FreeSummaryInput,
    pro: { ...shared, plan: "pro", findings: [], trend: null } as ProSummaryInput,
  };
}

function cardInput(plan: "free" | "pro", overrides: Partial<CardSummaryInput> = {}): CardSummaryInput {
  const base = {
    scope: "month" as const,
    period: { from: "2026-09-01", to: "2026-09-30" }, inProgress: false,
    total: 10_000, transactionCount: 4, categories: categories(),
    topMerchants: [], comparison: null, comparisonSkipped: false,
    flow: null,
  };
  return (plan === "free"
    ? { ...base, plan, ...overrides }
    : { ...base, plan, categoryChanges: null, ...overrides }) as CardSummaryInput;
}

function expectedTips(categoryRows: SummaryCategory[], count: number): { tips: string[]; ids: string[] } {
  const selected = categoryRows.map((row, i) => ({ ...row, i }))
    .filter(({ category }) => category !== "기타");
  const chosen = (selected.length ? selected : categoryRows.map((row, i) => ({ ...row, i }))).slice(0, count);
  const tips = chosen.map((item, i) => {
    if (i === 0) return `${item.category} 지출은 ${item.amount.toLocaleString("ko-KR")}원이에요. 다음 달 예산을 먼저 정해 보세요.`;
    if (i === 1) return `${item.category} 지출은 자주 가는 곳부터 한 주에 갈 횟수를 정해 보세요.`;
    return `${item.category} 지출이 지난번과 달라졌다면 그 이유를 살펴보세요.`;
  });
  return { tips, ids: chosen.map(({ category }) => ({
    "식비": "food", "카페·간식": "cafe", "기타": "etc",
  }[category] ?? "etc")) };
}

describe("createMockSummarizer", () => {
  it("uses the fixed model and returns plan-specific validated summaries with category-bound tips", async () => {
    const summarizer = createMockSummarizer();
    const inputs = monthlyInputs();
    expect(MOCK_SUMMARY_MODEL).toBe("mock");
    expect(summarizer.modelFor("free")).toBe("mock");
    expect(summarizer.modelFor("pro")).toBe("mock");

    for (const input of [inputs.free, inputs.pro]) {
      const result = await summarizer.summarize(input);
      const { tips, ids } = expectedTips(input.categories, 3);
      expect(result).toMatchObject({ ok: true, tips, tipCategories: ids });
      if (!result.ok) throw new Error("Expected mock monthly summary to validate");
      expect(result.summary).toContain("9월 1일~9월 30일");
      for (let i = 0; i < result.tips.length; i++) {
        expect(result.tips[i]).toContain(input.categories.find(({ category }) =>
          result.tipCategories[i] === ({ "식비": "food", "카페·간식": "cafe", "기타": "etc" }[category] ?? "etc"))?.category ?? "기타");
      }
    }
  });

  it("limits tips to available categories and keeps prompt content independent of input", async () => {
    const summarizer = createMockSummarizer();
    const fixedPrompt = summarizer.promptFor("free");
    const oneCategory = monthlyInputs().free;
    oneCategory.categories = categories([{ category: "식비", amount: 400, ratio: 1 }]);
    const single = await summarizer.summarize(oneCategory);
    expect(single).toMatchObject({ ok: true, tips: [expect.stringContaining("식비")], tipCategories: ["food"] });

    const onlyOther = { ...oneCategory, categories: categories([{ category: "기타", amount: 400, ratio: 1 }]) };
    expect(await summarizer.summarize(onlyOther)).toMatchObject({ ok: true, tips: [expect.stringContaining("기타")], tipCategories: ["etc"] });

    const changed = { ...oneCategory, categories: categories([{ category: "카페·간식", amount: 50, ratio: 1 }]) };
    await summarizer.summarize(changed);
    expect(summarizer.promptFor("free")).toBe(fixedPrompt);
    const template = JSON.parse(fixedPrompt) as { summary: string; comparison: string; tips: { category: string; text: string }[] };
    expect(template).toMatchObject({ comparison: "지난달보다 {monthOverMonth.diff} 늘었어요.", tips: [
      { category: "<카테고리>", text: expect.stringContaining("0원") },
      { category: "<카테고리>", text: expect.stringContaining("<카테고리>") },
      { category: "<카테고리>", text: expect.stringContaining("<카테고리>") },
    ] });
    expect(template.summary).toContain("{total}");
    expect(summarizer.promptFor("free")).not.toBe(summarizer.promptFor("pro"));
  });

  it.each([
    {
      name: "increase",
      input: { monthOverMonth: { previousMonth: "2026-08", previousTotal: 900, diff: 100, direction: "up" } },
      comparison: "지난달보다 ▲100원 늘었어요.",
    },
    {
      name: "decrease",
      input: { monthOverMonth: { previousMonth: "2026-08", previousTotal: 1100, diff: -100, direction: "down" } },
      comparison: "지난달보다 ▼100원 줄었어요.",
    },
    {
      name: "same",
      input: { monthOverMonth: { previousMonth: "2026-08", previousTotal: 1000, diff: 0, direction: "same" } },
      comparison: "지난달과 같아요.",
    },
    {
      name: "partial month",
      input: { partialMonth: "2026-08" },
      comparison: "8월 내역이 일부만 있어 지난달과는 비교하지 않았어요.",
    },
    { name: "no comparison", input: {}, comparison: "" },
  ] as const)("builds and validates monthly comparison for $name", async ({ input, comparison }) => {
    const summarizer = createMockSummarizer();
    const result = await summarizer.summarize({ ...monthlyInputs().free, ...input });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("Expected monthly comparison to validate");
    expect(result.summary.split("\n\n")).toHaveLength(comparison === "" ? 1 : 2);
    if (comparison !== "") expect(result.summary.split("\n\n")[1]).toBe(comparison);
  });
});

describe("createMockCardSummarizer", () => {
  it.each([
    { plan: "free", count: 2 }, { plan: "pro", count: 3 },
  ] as const)("returns category-bound card tips for $plan", async ({ plan, count }) => {
    const input = cardInput(plan, { categories: categories() });
    const summarizer = createMockCardSummarizer();
    const result = await summarizer.summarize(input);
    const { tips, ids } = expectedTips(input.categories, count);
    expect(MOCK_CARD_SUMMARY_MODEL).toBe("mock");
    expect(summarizer.modelFor(plan)).toBe("mock");
    expect(result).toMatchObject({ ok: true, tips, tipCategories: ids });
    if (!result.ok) throw new Error("Expected mock card summary to validate");
    expect(result.summary).toContain("9월 1일~9월 30일");
  });

  it("supports both scopes, only 기타, and a single available category", async () => {
    const summarizer = createMockCardSummarizer();
    const fixedPrompt = summarizer.promptFor("free");
    for (const scope of ["month", "statement"] as const) {
      const input = cardInput("free", {
        scope,
        period: { from: "2026-09-12", to: "2026-10-11" },
        categories: categories([{ category: "기타", amount: 400, ratio: 1 }]),
      });
      expect(await summarizer.summarize(input)).toMatchObject({ ok: true, tips: [expect.stringContaining("기타")], tipCategories: ["etc"] });
    }
    const one = cardInput("pro", { categories: categories([{ category: "식비", amount: 400, ratio: 1 }]) });
    expect(await summarizer.summarize(one)).toMatchObject({ ok: true, tips: [expect.stringContaining("식비")], tipCategories: ["food"] });
    expect(summarizer.promptFor("free")).not.toBe(summarizer.promptFor("pro"));
    const changedInput = cardInput("free", {
      scope: "statement",
      comparison: { previousTotal: 300, diff: 100, direction: "up" },
      flow: { direction: "mixed", periods: [
        { month: "2026-07", total: 100 },
        { month: "2026-08", total: 200 },
        { month: "2026-09", total: 150 },
      ] },
    });
    await summarizer.summarize(changedInput);
    expect(summarizer.promptFor("free")).toBe(fixedPrompt);
    expect(JSON.parse(fixedPrompt)).toMatchObject({
      comparison: "지난 기간보다 {comparison.diff} 늘었어요. 최근 세 번은 계속 늘었어요.",
    });
  });

  it("builds and validates card comparison sentences for each scope and state", async () => {
    const summarizer = createMockCardSummarizer();
    for (const scope of ["month", "statement"] as const) {
      const prev = scope === "month" ? "지난달" : "지난 명세서";
      const withComparison = (direction: "up" | "down" | "same") => cardInput("free", {
        scope,
        comparison: {
          previousTotal: 9000,
          diff: direction === "up" ? 1000 : direction === "down" ? -1000 : 0,
          direction,
        },
      });
      const expectedByDirection = {
        up: `${prev}보다 {comparison.diff} 늘었어요.`,
        down: `${prev}보다 {comparison.diff} 줄었어요.`,
        same: scope === "month" ? `${prev}과 같아요.` : `${prev}와 같아요.`,
      };
      for (const direction of ["up", "down", "same"] as const) {
        const result = await summarizer.summarize(withComparison(direction));
        expect(result).toMatchObject({ ok: true });
        if (!result.ok) throw new Error("Expected card comparison to validate");
        const renderedComparison = expectedByDirection[direction].replace("{comparison.diff}", direction === "up" ? "▲1,000원" : "▼1,000원");
        expect(result.summary.split("\n\n")).toHaveLength(2);
        expect(result.summary.split("\n\n")[1]).toBe(renderedComparison);
      }

      const skipped = cardInput("free", { scope, comparison: null, comparisonSkipped: true });
      const skippedResult = await summarizer.summarize(skipped);
      expect(skippedResult).toMatchObject({ ok: true });
      if (!skippedResult.ok) throw new Error("Expected skipped comparison to validate");
      expect(skippedResult.summary).toContain(scope === "month"
        ? "카드 내역이 일부만 있어 지난달과 비교하지 않았어요."
        : "이용 기간이 끝나기 전에 받은 명세서가 있어 지난 명세서와 비교하지 않았어요.");

      const noComparison = await summarizer.summarize(cardInput("free", { scope, comparison: null, comparisonSkipped: false }));
      expect(noComparison).toMatchObject({ ok: true });
      if (!noComparison.ok) throw new Error("Expected empty card comparison to validate");
      expect(noComparison.summary.split("\n\n")).toHaveLength(1);
    }
  });

  it.each([
    ["rising", "최근 세 번은 계속 늘었어요."],
    ["falling", "최근 세 번은 계속 줄었어요."],
    ["steady", "최근 세 번은 비슷했어요."],
    ["mixed", "최근 세 번은 한 방향으로 이어지지 않았어요."],
  ] as const)("adds and validates the %s flow sentence after comparison", async (direction, sentence) => {
    const input = cardInput("free", {
      comparison: { previousTotal: 9000, diff: 1000, direction: "up" },
      flow: {
        direction,
        periods: [
          { month: "2026-07", total: 7000 },
          { month: "2026-08", total: 8000 },
          { month: "2026-09", total: 9000 },
        ],
      },
    });
    const result = await createMockCardSummarizer().summarize(input);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("Expected flow comparison to validate");
    expect(result.summary.split("\n\n")).toHaveLength(2);
    expect(result.summary.split("\n\n")[1]).toBe(`지난달보다 ▲1,000원 늘었어요. ${sentence}`);
  });
});
