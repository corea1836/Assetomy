import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAnthropicApiKey } from "@/lib/env";
import { getMode } from "@/lib/mode";
import { SUMMARY_MODELS } from "./claude-summarizer";
import { getCardSummarizer, getMerchantClassifier, getMonthlySummarizer } from "./index";

const { fakeClient, getModeMock, getAnthropicApiKeyMock } = vi.hoisted(() => ({
  fakeClient: {
    messages: { parse: vi.fn() },
    beta: { messages: { parse: vi.fn() } },
  },
  getModeMock: vi.fn(),
  getAnthropicApiKeyMock: vi.fn(),
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(function () { return fakeClient; }),
}));
vi.mock("@/lib/mode", () => ({ getMode: getModeMock }));
vi.mock("@/lib/env", () => ({ getAnthropicApiKey: getAnthropicApiKeyMock }));

beforeEach(() => {
  vi.clearAllMocks();
  fakeClient.messages.parse.mockReset();
  fakeClient.beta.messages.parse.mockReset();
  getModeMock.mockReturnValue("mock");
  getAnthropicApiKeyMock.mockImplementation(() => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY");
    return process.env.ANTHROPIC_API_KEY;
  });
  for (const name of ["VERCEL_ENV", "VERCEL_URL", "NEXT_PUBLIC_SITE_URL", "APP_MODE", "ANTHROPIC_API_KEY"]) {
    vi.stubEnv(name, undefined);
  }
});
afterEach(() => vi.unstubAllEnvs());

describe("getMerchantClassifier", () => {
  it("uses mock classification without a key in mock mode", async () => {
    getModeMock.mockReturnValue("mock");
    const classifier = getMerchantClassifier();
    await expect(classifier.classify([
      { merchantKey: "쿠팡이츠", merchant: "쿠팡이츠" },
    ])).resolves.toEqual(new Map([["쿠팡이츠", "delivery"]]));
    expect(Anthropic).not.toHaveBeenCalled();
    expect(fakeClient.messages.parse).not.toHaveBeenCalled();
  });

  it("throws the exact configuration error without a live key", () => {
    getModeMock.mockReturnValue("live");
    expect(() => getMerchantClassifier()).toThrowError(/^ANTHROPIC_API_KEY$/);
    expect(Anthropic).not.toHaveBeenCalled();
  });

  it("creates the Haiku classifier with the prescribed timeout and retries", async () => {
    getModeMock.mockReturnValue("live");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    getAnthropicApiKeyMock.mockReturnValue("test-anthropic-key");
    fakeClient.messages.parse.mockResolvedValue({
      parsed_output: { results: [{ index: 0, category: "health" }] }, stop_reason: "end_turn",
    });
    const classifier = getMerchantClassifier();
    expect(Anthropic).toHaveBeenCalledExactlyOnceWith({
      apiKey: "test-anthropic-key", timeout: 30_000, maxRetries: 1,
    });
    expect(fakeClient.messages.parse).not.toHaveBeenCalled();
    await expect(classifier.classify([
      { merchantKey: "가맹점", merchant: "가맹점" },
    ])).resolves.toEqual(new Map([["가맹점", "health"]]));
    expect(fakeClient.messages.parse).toHaveBeenCalledTimes(1);
  });

  it("can be freshly imported without a live API key", async () => {
    getModeMock.mockReturnValue("live");
    vi.resetModules();
    await expect(import("./index")).resolves.toHaveProperty("getMerchantClassifier", expect.any(Function));
    expect(Anthropic).not.toHaveBeenCalled();
  });
});

describe("getMonthlySummarizer", () => {
  it("returns the mock summarizer without reading an API key in mock mode", async () => {
    getModeMock.mockReturnValue("mock");
    const summarizer = getMonthlySummarizer();
    expect(getMode).toHaveBeenCalledOnce();
    expect(summarizer.modelFor("free")).toBe("mock");
    await expect(summarizer.summarize({
      plan: "free", month: "2026-09", inProgress: false,
      period: { from: "2026-09-01", to: "2026-09-30" }, total: 0, transactionCount: 0,
      categories: [], topMerchants: [], monthOverMonth: null, partialMonth: null,
      candidates: {
        recurring: { count: 0, amount: 0 }, duplicate: { count: 0, amount: 0 },
        large: { count: 0, amount: 0 }, candidateTotal: 0,
      },
    })).resolves.toMatchObject({ ok: true });
    expect(getAnthropicApiKey).not.toHaveBeenCalled();
    expect(Anthropic).not.toHaveBeenCalled();
  });

  it("defers live API key access until summarize", async () => {
    getModeMock.mockReturnValue("live");
    const summarizer = getMonthlySummarizer();
    expect(getAnthropicApiKey).not.toHaveBeenCalled();
    expect(Anthropic).not.toHaveBeenCalled();
    expect(summarizer.modelFor("free")).toBe(SUMMARY_MODELS.free);
    expect(summarizer.modelFor("pro")).toBe(SUMMARY_MODELS.pro);
  });

  it("returns request_failed when lazy key access throws", async () => {
    getModeMock.mockReturnValue("live");
    getAnthropicApiKeyMock.mockImplementation(() => { throw new Error("missing key"); });
    const summarizer = getMonthlySummarizer();
    await expect(summarizer.summarize({
      plan: "free", month: "2026-09", inProgress: false,
      period: { from: "2026-09-01", to: "2026-09-30" }, total: 0, transactionCount: 0,
      categories: [], topMerchants: [], monthOverMonth: null, partialMonth: null,
      candidates: {
        recurring: { count: 0, amount: 0 }, duplicate: { count: 0, amount: 0 },
        large: { count: 0, amount: 0 }, candidateTotal: 0,
      },
    })).resolves.toEqual({ ok: false, reason: "request_failed" });
    expect(getAnthropicApiKey).toHaveBeenCalledOnce();
  });
});

describe("getCardSummarizer", () => {
  it("returns the mock card summarizer without reading an API key in mock mode", async () => {
    getModeMock.mockReturnValue("mock");
    const summarizer = getCardSummarizer();
    expect(summarizer.modelFor("free")).toBe("mock");
    await expect(summarizer.summarize({
      plan: "free", scope: "month", period: { from: "2026-09-01", to: "2026-09-30" },
      inProgress: false, total: 0, transactionCount: 0, categories: [], topMerchants: [],
      comparison: null, comparisonSkipped: false,
    })).resolves.toMatchObject({ ok: true });
    expect(getAnthropicApiKey).not.toHaveBeenCalled();
    expect(Anthropic).not.toHaveBeenCalled();
  });

  it("defers live key access and model client creation until summarize", () => {
    getModeMock.mockReturnValue("live");
    const summarizer = getCardSummarizer();
    expect(getAnthropicApiKey).not.toHaveBeenCalled();
    expect(Anthropic).not.toHaveBeenCalled();
    expect(summarizer.modelFor("free")).toBe(SUMMARY_MODELS.free);
    expect(summarizer.modelFor("pro")).toBe(SUMMARY_MODELS.pro);
  });

  it("maps missing live key to request_failed at summarize time", async () => {
    getModeMock.mockReturnValue("live");
    getAnthropicApiKeyMock.mockImplementation(() => { throw new Error("missing key"); });
    const summarizer = getCardSummarizer();
    await expect(summarizer.summarize({
      plan: "free", scope: "month", period: { from: "2026-09-01", to: "2026-09-30" },
      inProgress: false, total: 0, transactionCount: 0, categories: [], topMerchants: [],
      comparison: null, comparisonSkipped: false,
    })).resolves.toEqual({ ok: false, reason: "request_failed" });
    expect(getAnthropicApiKey).toHaveBeenCalledOnce();
  });
});
