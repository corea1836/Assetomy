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
    expect(template).toMatchObject({ comparison: "", tips: [
      { category: "<카테고리>", text: expect.stringContaining("0원") },
      { category: "<카테고리>", text: expect.stringContaining("<카테고리>") },
      { category: "<카테고리>", text: expect.stringContaining("<카테고리>") },
    ] });
    expect(template.summary).toContain("{total}");
    expect(summarizer.promptFor("free")).not.toBe(summarizer.promptFor("pro"));
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
  });
});
