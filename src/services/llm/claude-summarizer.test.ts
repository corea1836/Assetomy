import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { FreeCardSummaryInput, FreeSummaryInput, ProCardSummaryInput, ProSummaryInput } from "@/types/summary";
import { checkSummaryContent } from "./summary-text";
import {
  CARD_FREE_SYSTEM, CARD_PRO_SYSTEM, createClaudeCardSummarizer, createClaudeSummarizer,
  FREE_SYSTEM, PRO_SYSTEM, SUMMARY_MODELS,
} from "./claude-summarizer";

type ParseRequest = Parameters<Anthropic["beta"]["messages"]["parse"]>[0];

function freeInput(): FreeSummaryInput {
  return {
    plan: "free", month: "2026-09", inProgress: false,
    period: { from: "2026-09-01", to: "2026-09-30" }, total: 1000, transactionCount: 1,
    categories: [{ category: "식비", amount: 1000, ratio: 1, topMerchant: null, feedback: null }], topMerchants: [], monthOverMonth: null, partialMonth: null,
    candidates: {
      recurring: { count: 0, amount: 0 }, duplicate: { count: 0, amount: 0 },
      large: { count: 0, amount: 0 }, candidateTotal: 0,
    },
  };
}

function proInput(): ProSummaryInput {
  return { ...freeInput(), plan: "pro", findings: [], trend: null };
}

function cardInputs(): { freeMonth: FreeCardSummaryInput; freeStatement: FreeCardSummaryInput; proMonth: ProCardSummaryInput; proStatement: ProCardSummaryInput } {
  const shared = {
    period: { from: "2026-09-01", to: "2026-09-30" }, inProgress: false, total: 1000, transactionCount: 1,
    categories: [{ category: "식비", amount: 1000, ratio: 1, topMerchant: null, feedback: null }],
    topMerchants: [{ merchant: "가게", category: "식비", amount: 1000, count: 1 }],
    comparison: { previousTotal: 900, diff: 100, direction: "up" as const }, comparisonSkipped: false, flow: null,
  };
  const freeMonth: FreeCardSummaryInput = { ...shared, plan: "free", scope: "month" };
  const freeStatement: FreeCardSummaryInput = { ...shared, plan: "free", scope: "statement" };
  const proMonth: ProCardSummaryInput = {
    ...shared, plan: "pro", scope: "month",
    categoryChanges: [{ category: "식비", current: 1000, previous: 900, diff: 100 }],
  };
  const proStatement: ProCardSummaryInput = { ...proMonth, scope: "statement" };
  return { freeMonth, freeStatement, proMonth, proStatement };
}

function validContent() {
  return {
    summary: "이번 달에는 식비 비중이 가장 크게 나타났어요.",
    comparison: "",
    tips: [
      { category: "식비", text: "다음 달에는 식비 예산을 먼저 정해 보세요." },
      { category: "식비", text: "식비 지출 중 같은 결제가 두 번 청구됐는지 카드사 앱에서 확인해 보세요." },
    ],
  };
}

function fakeClient() {
  const parse = vi.fn<(request: ParseRequest) => Promise<unknown>>();
  const client = { beta: { messages: { parse } } } as unknown as Pick<Anthropic, "beta">;
  return { parse, client };
}

function response(parsed_output: unknown, stop_reason = "end_turn") {
  return { parsed_output, stop_reason };
}

describe("createClaudeSummarizer", () => {
  it("프롬프트가 바뀌면 저장된 요약이 모두 다시 만들어진다. 의도한 변경일 때만 기대값을 고친다", () => {
    expect(createHash("sha256").update(FREE_SYSTEM).digest("hex"))
      .toBe("dc5b37ba9287191523190c634262b87865ccd056240b5a5241c5bf448ae6b759");
    expect(createHash("sha256").update(PRO_SYSTEM).digest("hex"))
      .toBe("fd530c44277fb34940eac4f02471baf3e72ea85591c42c7b364ea91da441b374");
    expect(createHash("sha256").update(CARD_FREE_SYSTEM).digest("hex"))
      .toBe("946457af27558b8ab98ffc20f90d8cca1cf02ee297a19030f123c7ef6b8db8a5");
    expect(createHash("sha256").update(CARD_PRO_SYSTEM).digest("hex"))
      .toBe("0b0b89d4c23e773c986473f54e82f743e38bc3c66d3e4461accf33dcbbcce3f9");
  });

  it.each([
    { input: freeInput(), model: "claude-sonnet-5-5" },
    { input: proInput(), model: "claude-opus-5-5" },
  ])("sends the prescribed structured request for $model", async ({ input, model }) => {
    const { parse, client } = fakeClient();
    parse.mockResolvedValue(response(validContent()));
    const summarizer = createClaudeSummarizer(() => client);

    await expect(summarizer.summarize(input)).resolves.toEqual({
      ok: true,
      summary: validContent().summary,
      tips: validContent().tips.map(({ text }) => text),
      tipCategories: ["food", "food"],
    });
    expect(summarizer.modelFor(input.plan)).toBe(model);
    expect(summarizer.promptFor(input.plan)).toBe(input.plan === "free" ? FREE_SYSTEM : PRO_SYSTEM);
    const request = parse.mock.calls[0][0];
    expect(request).toMatchObject({
      model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema" } },
      messages: [{ role: "user", content: JSON.stringify(input) }],
    });
    expect(request.output_config?.format).toHaveProperty("parse", expect.any(Function));
    expect(request).not.toHaveProperty("thinking");
    expect(request).not.toHaveProperty("temperature");
    expect(request.system).toBe(input.plan === "free" ? FREE_SYSTEM : PRO_SYSTEM);
    expect(request.system).toContain("숫자를 직접 쓰지 않고");
    expect(request.system).toContain("{categories[0].ratio}");
    expect(request.system).toContain("아낄 수 있는 금액을 약속하지 않고");
    expect(request.system).toContain("정상 지출일 수 있다고 함께 말합니다");
    expect(request.system).toContain("가맹점명과 카테고리명은 입력에 적힌 그대로 씁니다");
    expect(request.system).toContain("comparison");
    expect(request.system).toContain("▲");
    expect(request.system).toContain("topMerchant");
    expect(request.system).toContain("feedback");
    expect(request.system).toContain("지시");
    expect(request.system).toContain("기타");
    expect(request.system).toContain("금융상품을 추천하지 않습니다");
    expect(request.system).toContain("1~5개");
    if (input.plan === "free") {
      expect(request.system).toContain("candidates에는 정기결제·중복 결제 의심·고액 결제의 종류별 건수와 합계만 있습니다");
      expect(request.system).toContain("카드사 앱");
      expect(request.system).not.toContain("findings");
      expect(request.system).not.toContain("trend.categoryChanges");
      expect(request.system).not.toContain("trend");
    } else {
      expect(request.system).toContain("trend.categoryChanges");
      expect(request.system).toContain("findings");
      expect(request.system).not.toContain("candidates에는 종류별 건수와 합계만 있습니다");
    }
  });

  it("validates the SDK's Zod structured output format", async () => {
    const { parse, client } = fakeClient();
    parse.mockResolvedValue(response(validContent()));
    await createClaudeSummarizer(() => client).summarize(freeInput());
    const format = parse.mock.calls[0][0].output_config?.format;
    if (!format || !("parse" in format) || typeof format.parse !== "function") {
      throw new Error("Expected an SDK structured-output parser");
    }
    const parseOutput = format.parse;
    expect(parseOutput(JSON.stringify({ summary: "요약", comparison: "", tips: [{ category: "식비", text: "팁" }] })))
      .toEqual({ summary: "요약", comparison: "", tips: [{ category: "식비", text: "팁" }] });
    expect(() => parseOutput(JSON.stringify({ summary: 2, comparison: "", tips: [] }))).toThrow();
    expect(() => parseOutput(JSON.stringify({ summary: "요약", tips: [] }))).toThrow();
  });

  it.each([
    ["refusal", response(validContent(), "refusal"), "refusal"],
    ["max_tokens", response(validContent(), "max_tokens"), "max_tokens"],
    ["null parsed output", response(null), "invalid_output"],
    ["empty parsed output", response({}), "invalid_output"],
    ["non-string summary", response({ summary: 1, comparison: "", tips: [] }), "invalid_output"],
    ["missing comparison", response({ summary: validContent().summary, tips: validContent().tips }), "invalid_output"],
    ["missing tips", response({ summary: validContent().summary, comparison: "" }), "invalid_output"],
    ["non-string tip", response({ summary: validContent().summary, comparison: "", tips: [{ category: "식비", text: 1 }] }), "invalid_output"],
  ] as const)("returns %s without rejecting", async (_name, result, reason) => {
    const { client } = fakeClient();
    client.beta.messages.parse = vi.fn().mockResolvedValue(result) as typeof client.beta.messages.parse;
    await expect(createClaudeSummarizer(() => client).summarize(freeInput()))
      .resolves.toEqual({ ok: false, reason });
  });

  it("returns content with placeholders filled from the input", async () => {
    const { parse, client } = fakeClient();
    parse.mockResolvedValue(response({
      summary: "{period} 동안 {transactionCount}, {total}을 썼어요.",
      comparison: "",
      tips: [{ category: "식비", text: "식비 예산을 먼저 정하고 카드 지출을 살펴보세요." }],
    }));
    await expect(createClaudeSummarizer(() => client).summarize(freeInput())).resolves.toEqual({
      ok: true,
      summary: "9월 1일~9월 30일 동안 1건, 1,000원을 썼어요.",
      tips: ["식비 예산을 먼저 정하고 카드 지출을 살펴보세요."],
      tipCategories: ["food"],
    });
  });

  it("maps invalid content to the content check result without rewriting", async () => {
    const invalid = { summary: validContent().summary, comparison: "", tips: [{ category: "식비", text: "식비를 3번 줄이도록 예산을 정해 보세요." }] };
    const { parse, client } = fakeClient();
    parse.mockResolvedValue(response(invalid));
    await expect(createClaudeSummarizer(() => client).summarize(freeInput()))
      .resolves.toEqual(checkSummaryContent(invalid, freeInput()));
    await expect(createClaudeSummarizer(() => client).summarize(freeInput()))
      .resolves.toEqual({ ok: false, reason: "number" });
  });

  it("maps parse rejection and client construction failure to request_failed", async () => {
    const { parse, client } = fakeClient();
    parse.mockRejectedValue(new Error("sensitive response"));
    await expect(createClaudeSummarizer(() => client).summarize(freeInput()))
      .resolves.toEqual({ ok: false, reason: "request_failed" });
    await expect(createClaudeSummarizer(() => { throw new Error("sensitive key error"); }).summarize(freeInput()))
      .resolves.toEqual({ ok: false, reason: "request_failed" });
  });

  it("does not create the client until summarize is called", () => {
    const createClient = vi.fn(() => fakeClient().client);
    const summarizer = createClaudeSummarizer(createClient);
    expect(createClient).not.toHaveBeenCalled();
    expect(summarizer.modelFor("free")).toBe(SUMMARY_MODELS.free);
  });
});

describe("createClaudeCardSummarizer", () => {
  it.each([
    { input: cardInputs().freeMonth, model: SUMMARY_MODELS.free },
    { input: cardInputs().freeStatement, model: SUMMARY_MODELS.free },
    { input: cardInputs().proMonth, model: SUMMARY_MODELS.pro },
    { input: cardInputs().proStatement, model: SUMMARY_MODELS.pro },
  ])("uses the plan's model, card prompt, and structured request for $input.plan/$input.scope", async ({ input, model }) => {
    const content = {
      summary: "{period} 동안 {transactionCount}, {total}을 썼어요. 식비가 {categories[0].ratio}로 큰 비중을 차지해요.",
      comparison: "",
      tips: [{ category: "식비", text: "식비 예산을 정하고 다음 달 지출 흐름을 살펴보세요." }],
    };
    const { parse, client } = fakeClient();
    parse.mockResolvedValue(response(content));
    const summarizer = createClaudeCardSummarizer(() => client);

    await expect(summarizer.summarize(input)).resolves.toEqual({
      ok: true,
      summary: "9월 1일~9월 30일 동안 1건, 1,000원을 썼어요. 식비가 100%로 큰 비중을 차지해요.",
      tips: content.tips.map(({ text }) => text),
      tipCategories: ["food"],
    });
    expect(summarizer.modelFor(input.plan)).toBe(model);
    expect(summarizer.promptFor(input.plan)).toBe(input.plan === "free" ? CARD_FREE_SYSTEM : CARD_PRO_SYSTEM);
    expect(parse.mock.calls[0][0]).toMatchObject({
      model, max_tokens: 16000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema" } },
      messages: [{ role: "user", content: JSON.stringify(input) }],
    });
  });

  it("includes card flow labels, scope, names, and Free/Pro input boundaries", () => {
    expect(CARD_FREE_SYSTEM).toContain("이번 명세서");
    expect(CARD_FREE_SYSTEM).toContain("comparisonSkipped");
    expect(CARD_FREE_SYSTEM).toContain("카드 이름");
    expect(CARD_FREE_SYSTEM).toContain("flow");
    expect(CARD_FREE_SYSTEM).toContain("rising");
    expect(CARD_FREE_SYSTEM).toContain("계속 늘었어요");
    expect(CARD_FREE_SYSTEM).toContain("한 방향으로 이어지지 않았어요");
    expect(CARD_FREE_SYSTEM).toContain("금융상품");
    expect(CARD_FREE_SYSTEM).toContain("topMerchant");
    expect(CARD_FREE_SYSTEM).toContain("feedback");
    expect(CARD_FREE_SYSTEM).not.toContain("flow.categories");
    expect(CARD_PRO_SYSTEM).toContain("categoryChanges");
    expect(CARD_PRO_SYSTEM).toContain("flow.categories");
    expect(CARD_PRO_SYSTEM).toContain(CARD_FREE_SYSTEM);
  });

  it.each([
    ["refusal", response({}, "refusal"), "refusal"],
    ["max_tokens", response({}, "max_tokens"), "max_tokens"],
    ["invalid output", response(null), "invalid_output"],
  ] as const)("maps card summary %s", async (_name, result, reason) => {
    const { client } = fakeClient();
    client.beta.messages.parse = vi.fn().mockResolvedValue(result) as typeof client.beta.messages.parse;
    await expect(createClaudeCardSummarizer(() => client).summarize(cardInputs().freeMonth))
      .resolves.toEqual({ ok: false, reason });
  });

  it("maps content, request, and client creation failures without rejecting", async () => {
    const invalid = {
      summary: "이번 달 이 카드에서는 3건의 지출을 확인했어요.", comparison: "",
      tips: [{ category: "식비", text: "식비 예산을 정하고 다음 달 지출 흐름을 살펴보세요." }],
    };
    const { parse, client } = fakeClient();
    parse.mockResolvedValue(response(invalid));
    await expect(createClaudeCardSummarizer(() => client).summarize(cardInputs().freeMonth))
      .resolves.toEqual(checkSummaryContent(invalid, cardInputs().freeMonth));
    await expect(createClaudeCardSummarizer(() => client).summarize(cardInputs().freeMonth))
      .resolves.toEqual({ ok: false, reason: "number" });
    parse.mockRejectedValue(new Error("sensitive response"));
    await expect(createClaudeCardSummarizer(() => client).summarize(cardInputs().freeMonth))
      .resolves.toEqual({ ok: false, reason: "request_failed" });
    await expect(createClaudeCardSummarizer(() => { throw new Error("sensitive key error"); }).summarize(cardInputs().freeMonth))
      .resolves.toEqual({ ok: false, reason: "request_failed" });
  });

  it("does not create the client until summarize is called", () => {
    const createClient = vi.fn(() => fakeClient().client);
    const summarizer = createClaudeCardSummarizer(createClient);
    expect(createClient).not.toHaveBeenCalled();
    expect(summarizer.modelFor("free")).toBe(SUMMARY_MODELS.free);
  });
});
