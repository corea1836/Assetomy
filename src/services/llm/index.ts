import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicApiKey } from "@/lib/env";
import { getMode } from "@/lib/mode";
import { createHaikuClassifier } from "./haiku-classifier";
import { createMockClassifier } from "./mock-classifier";
import { createClaudeSummarizer } from "./claude-summarizer";
import { createMockSummarizer } from "./mock-summarizer";
import type { MerchantClassifier, MonthlySummarizer } from "./types";

export function getMerchantClassifier(): MerchantClassifier {
  if (getMode() === "mock") return createMockClassifier();
  const client = new Anthropic({
    apiKey: getAnthropicApiKey(), timeout: 30_000, maxRetries: 1,
  });
  return createHaikuClassifier(client);
}

export function getMonthlySummarizer(): MonthlySummarizer {
  if (getMode() === "mock") return createMockSummarizer();
  return createClaudeSummarizer(() => new Anthropic({
    apiKey: getAnthropicApiKey(),
    timeout: 60_000,
    maxRetries: 1,
  }));
}
