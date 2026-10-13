import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMerchantClassifier } from "./index";

const { fakeClient } = vi.hoisted(() => ({ fakeClient: { messages: { parse: vi.fn() } } }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(function () { return fakeClient; }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  fakeClient.messages.parse.mockReset();
  for (const name of ["VERCEL_ENV", "VERCEL_URL", "NEXT_PUBLIC_SITE_URL", "APP_MODE", "ANTHROPIC_API_KEY"]) {
    vi.stubEnv(name, undefined);
  }
});
afterEach(() => vi.unstubAllEnvs());

describe("getMerchantClassifier", () => {
  it.each([
    [undefined, undefined], [undefined, "mock"], ["preview", "live"],
  ])("uses mock classification without a key in %s / %s", async (vercelEnv, appMode) => {
    vi.stubEnv("VERCEL_ENV", vercelEnv);
    vi.stubEnv("APP_MODE", appMode);
    const classifier = getMerchantClassifier();
    await expect(classifier.classify([
      { merchantKey: "쿠팡이츠", merchant: "쿠팡이츠" },
    ])).resolves.toEqual(new Map([["쿠팡이츠", "delivery"]]));
    expect(Anthropic).not.toHaveBeenCalled();
    expect(fakeClient.messages.parse).not.toHaveBeenCalled();
  });

  it.each([[undefined, "live"], ["production", "mock"]])(
    "throws the exact configuration error without a live key in %s / %s",
    (vercelEnv, appMode) => {
      vi.stubEnv("VERCEL_ENV", vercelEnv);
      vi.stubEnv("APP_MODE", appMode);
      expect(() => getMerchantClassifier()).toThrowError(/^ANTHROPIC_API_KEY$/);
      expect(Anthropic).not.toHaveBeenCalled();
    },
  );

  it("creates the Haiku classifier with the prescribed timeout and retries", async () => {
    vi.stubEnv("APP_MODE", "live");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
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
    vi.stubEnv("APP_MODE", "live");
    vi.resetModules();
    await expect(import("./index")).resolves.toHaveProperty("getMerchantClassifier", expect.any(Function));
    expect(Anthropic).not.toHaveBeenCalled();
  });
});
