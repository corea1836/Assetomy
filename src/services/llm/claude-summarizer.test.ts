import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { FreeSummaryInput, ProSummaryInput } from "@/types/summary";
import { checkSummaryText } from "./summary-text";
import { createClaudeSummarizer, FREE_SYSTEM, PRO_SYSTEM, SUMMARY_MODELS } from "./claude-summarizer";

type ParseRequest = Parameters<Anthropic["beta"]["messages"]["parse"]>[0];

function freeInput(): FreeSummaryInput {
  return {
    plan: "free", month: "2026-09", inProgress: false,
    period: { from: "2026-09-01", to: "2026-09-30" }, total: 1000, transactionCount: 1,
    categories: [], topMerchants: [], monthOverMonth: null,
    candidates: {
      recurring: { count: 0, amount: 0 }, duplicate: { count: 0, amount: 0 },
      large: { count: 0, amount: 0 }, candidateTotal: 0,
    },
  };
}

function proInput(): ProSummaryInput {
  return { ...freeInput(), plan: "pro", findings: [], trend: null };
}

function validSummary() {
  return "이번 달에는 식비 비중이 가장 크게 나타났어요. 지난달보다 소비 흐름이 줄었고, 여러 카테고리를 함께 살펴보면 생활 속 지출 특징을 차분히 파악하기 쉬워요.";
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
  it.each([
    { input: freeInput(), model: "claude-sonnet-5-5" },
    { input: proInput(), model: "claude-opus-5-5" },
  ])("sends the prescribed structured request for $model", async ({ input, model }) => {
    const { parse, client } = fakeClient();
    parse.mockResolvedValue(response({ summary: validSummary() }));
    const summarizer = createClaudeSummarizer(() => client);

    await expect(summarizer.summarize(input)).resolves.toEqual({ ok: true, text: validSummary() });
    expect(summarizer.modelFor(input.plan)).toBe(model);
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
    expect(request.system).toContain("숫자를 쓰지 않습니다");
    expect(request.system).toContain("정상 지출일 수 있다고 함께 말합니다");
    expect(request.system).toContain("가맹점명과 카테고리명은 입력에 적힌 그대로 씁니다");
    if (input.plan === "free") {
      expect(request.system).toContain("candidates에는 종류별 건수와 합계만 있습니다");
      expect(request.system).not.toContain("findings는 확인이 필요한 지출 후보입니다");
    } else {
      expect(request.system).toContain("findings는 확인이 필요한 지출 후보입니다");
      expect(request.system).not.toContain("candidates에는 종류별 건수와 합계만 있습니다");
    }
  });

  it("validates the SDK's Zod structured output format", async () => {
    const { parse, client } = fakeClient();
    parse.mockResolvedValue(response({ summary: validSummary() }));
    await createClaudeSummarizer(() => client).summarize(freeInput());
    const format = parse.mock.calls[0][0].output_config?.format;
    if (!format || !("parse" in format) || typeof format.parse !== "function") {
      throw new Error("Expected an SDK structured-output parser");
    }
    const parseOutput = format.parse;
    expect(parseOutput(JSON.stringify({ summary: "요약" }))).toEqual({ summary: "요약" });
    expect(() => parseOutput(JSON.stringify({ summary: 2 }))).toThrow();
  });

  it.each([
    ["refusal", response({ summary: validSummary() }, "refusal"), "refusal"],
    ["max_tokens", response({ summary: validSummary() }, "max_tokens"), "max_tokens"],
    ["null parsed output", response(null), "invalid_output"],
    ["empty parsed output", response({}), "invalid_output"],
    ["non-string summary", response({ summary: 1 }), "invalid_output"],
  ] as const)("returns %s without rejecting", async (_name, result, reason) => {
    const { client } = fakeClient();
    client.beta.messages.parse = vi.fn().mockResolvedValue(result) as typeof client.beta.messages.parse;
    await expect(createClaudeSummarizer(() => client).summarize(freeInput()))
      .resolves.toEqual({ ok: false, reason });
  });

  it("maps invalid summary text to the text check result without rewriting", async () => {
    const invalidText = "이번 달에는 지출 3건이 보였어요. 카테고리별 흐름을 살펴보면 소비의 특징을 더 쉽게 파악할 수 있어요.";
    const { parse, client } = fakeClient();
    parse.mockResolvedValue(response({ summary: invalidText }));
    await expect(createClaudeSummarizer(() => client).summarize(freeInput()))
      .resolves.toEqual(checkSummaryText(invalidText, freeInput()));
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
