import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { CATEGORY_IDS, CATEGORY_LABELS } from "@/types/category";
import {
  CLASSIFIER_MODEL, CLASSIFY_BATCH_SIZE, CLASSIFY_CONCURRENCY, createHaikuClassifier,
} from "./haiku-classifier";
import type { MerchantClassifier, MerchantInput } from "./types";

type ParseRequest = Parameters<Anthropic["messages"]["parse"]>[0];

function fakeClient() {
  const parse = vi.fn<(request: ParseRequest) => Promise<unknown>>();
  const client = { messages: { parse } } as unknown as Pick<Anthropic, "messages">;
  return { parse, classifier: createHaikuClassifier(client) };
}

function merchants(count: number): MerchantInput[] {
  return Array.from({ length: count }, (_, index) => ({
    merchantKey: `KEY-${index}`, merchant: `가맹점 ${index}`,
  }));
}

function response(results: unknown, stop_reason = "end_turn") {
  return { parsed_output: { results }, stop_reason };
}

function requestRows(request: ParseRequest): string[] {
  const content = request.messages[0].content;
  if (typeof content !== "string") throw new Error("Expected a text message");
  return content.split("\n");
}

describe("createHaikuClassifier", () => {
  it("exposes only merchant fields in the input contract", () => {
    expectTypeOf<MerchantInput>().toEqualTypeOf<{ merchantKey: string; merchant: string }>();
    expectTypeOf<MerchantClassifier["classify"]>().toEqualTypeOf<
      (input: MerchantInput[]) => Promise<Map<string, (typeof CATEGORY_IDS)[number]>>
    >();
  });

  it.each([450, 1000])("batches %i unique keys and limits in-flight requests to three", async (count) => {
    const { parse, classifier } = fakeClient();
    const pending: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    parse.mockImplementation((request) => {
      active += 1;
      peak = Math.max(peak, active);
      return new Promise((resolve) => {
        pending.push(() => {
          active -= 1;
          resolve(response(requestRows(request).map((_, index) => ({ index, category: "food" }))));
        });
      });
    });

    const input = merchants(count);
    const classification = classifier.classify(input);
    expect(parse).toHaveBeenCalledTimes(3);
    expect(active).toBe(3);
    // Finish out of order, checking that each freed worker starts the next batch.
    if (count === 1000) {
      pending[1]();
      await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(4));
      expect(active).toBe(3);
      pending[0]();
      await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(5));
      expect(active).toBe(3);
      pending[3]();
      pending[4]();
    } else {
      pending[1]();
      pending[0]();
    }
    pending[2]();

    const result = await classification;
    expect(CLASSIFY_BATCH_SIZE).toBe(200);
    expect(CLASSIFY_CONCURRENCY).toBe(3);
    expect(peak).toBe(3);
    expect(active).toBe(0);
    expect(parse.mock.calls.map(([request]) => requestRows(request).length)).toEqual(
      count === 450 ? [200, 200, 50] : [200, 200, 200, 200, 200],
    );
    expect(parse.mock.calls.map(([request]) => requestRows(request))).toEqual(
      Array.from({ length: Math.ceil(count / 200) }, (_, batch) =>
        input.slice(batch * 200, (batch + 1) * 200).map(({ merchant }, index) => `${index}\t${merchant}`),
      ),
    );
    expect(result).toEqual(new Map(input.map(({ merchantKey }) => [merchantKey, "food"])));
  });

  it("sends only numbered display names with a fixed category system prompt", async () => {
    const { parse, classifier } = fakeClient();
    parse.mockResolvedValue(response([]));
    await classifier.classify([{ merchantKey: "PRIVATE-KEY", merchant: "스타벅스 강남점" }]);
    await classifier.classify([{ merchantKey: "OTHER-KEY", merchant: "동네 식당" }]);

    const request = parse.mock.calls[0][0];
    expect(CLASSIFIER_MODEL).toBe("claude-haiku-5-5");
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.max_tokens).toBe(16000);
    expect(request.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(request.messages).toEqual([{ role: "user", content: "0\t스타벅스 강남점" }]);
    expect(request.system).toBe(parse.mock.calls[1][0].system);
    for (const id of CATEGORY_IDS) {
      expect(request.system).toContain(id);
      expect(request.system).toContain(CATEGORY_LABELS[id]);
    }
    expect(JSON.stringify(request)).not.toContain("PRIVATE-KEY");

    // Exercise the SDK's actual zod v4 structured-output parser without HTTP.
    const format = request.output_config?.format;
    expect(format).toHaveProperty("parse", expect.any(Function));
    if (!format || !("parse" in format) || typeof format.parse !== "function") {
      throw new Error("Expected the SDK's structured-output parser");
    }
    const parseOutput = format.parse;
    const valid = { results: [{ index: 0, category: "cafe" }] };
    expect(parseOutput(JSON.stringify(valid))).toEqual(valid);
    expect(() => parseOutput('{"results":[{"index":0,"category":"invalid"}]}')).toThrow();
    expect(() => parseOutput('{"results":[{"index":0.5,"category":"cafe"}]}')).toThrow();
  });

  it("maps all fourteen valid categories by batch index, regardless of response order", async () => {
    const { parse, classifier } = fakeClient();
    parse.mockResolvedValue(response(CATEGORY_IDS.map((category, index) => ({ index, category })).reverse()));
    const input = merchants(CATEGORY_IDS.length);
    await expect(classifier.classify(input)).resolves.toEqual(
      new Map(input.map(({ merchantKey }, index) => [merchantKey, CATEGORY_IDS[index]])),
    );
  });

  it("ignores out-of-range indices and leaves duplicated or missing indices as etc", async () => {
    const { parse, classifier } = fakeClient();
    parse.mockResolvedValue(response([
      { index: -1, category: "food" }, { index: 4, category: "food" },
      { index: 0, category: "cafe" }, { index: 1, category: "food" },
      { index: 1, category: "food" }, { index: 2, category: "shopping" },
      { index: 2, category: "health" },
    ]));
    await expect(classifier.classify(merchants(4))).resolves.toEqual(
      new Map([["KEY-0", "cafe"], ["KEY-1", "etc"], ["KEY-2", "etc"], ["KEY-3", "etc"]]),
    );
  });

  it.each([
    { name: "null parsed output", value: { parsed_output: null, stop_reason: "end_turn" } },
    { name: "missing parsed output", value: { stop_reason: "end_turn" } },
    { name: "refusal", value: response([{ index: 0, category: "food" }], "refusal") },
    { name: "truncation", value: response([{ index: 0, category: "food" }], "max_tokens") },
    { name: "invalid category", value: response([{ index: 0, category: "cafe" }, { index: 1, category: "unknown" }]) },
    { name: "non-integer index", value: response([{ index: 0.5, category: "food" }]) },
    { name: "string index", value: response([{ index: "0", category: "food" }]) },
    { name: "missing results", value: { parsed_output: {}, stop_reason: "end_turn" } },
    { name: "non-array results", value: response({ index: 0, category: "food" }) },
    { name: "null response", value: null },
    { name: "undefined response", value: undefined },
  ])("resolves all batch keys as etc for $name", async ({ value }) => {
    const { parse, classifier } = fakeClient();
    parse.mockResolvedValue(value);
    await expect(classifier.classify(merchants(2))).resolves.toEqual(
      new Map([["KEY-0", "etc"], ["KEY-1", "etc"]]),
    );
  });

  it("isolates one rejected batch from the other batches", async () => {
    const { parse, classifier } = fakeClient();
    parse.mockImplementation(async (request) => response(
      requestRows(request).map((_, index) => ({ index, category: "cafe" })),
    ));
    parse.mockRejectedValueOnce(new Error("x"));
    const input = merchants(450);
    await expect(classifier.classify(input)).resolves.toEqual(new Map(
      input.map(({ merchantKey }, index) => [merchantKey, index < 200 ? "etc" : "cafe"]),
    ));
    expect(parse).toHaveBeenCalledTimes(3);
  });

  it.each([
    new Error("sensitive-error-message"),
    new Anthropic.APIError(429, { message: "sensitive-response" }, "sensitive-error-message", new Headers()),
    new Anthropic.APIConnectionTimeoutError({ message: "sensitive-error-message" }),
    "sensitive-error-message", null,
  ])("never rejects when the SDK throws or rejects: %#", async (error) => {
    const { parse, classifier } = fakeClient();
    parse.mockRejectedValueOnce(error).mockImplementationOnce(() => { throw error; });
    const expected = new Map([["KEY-0", "etc"]]);
    await expect(classifier.classify(merchants(1))).resolves.toEqual(expected);
    await expect(classifier.classify(merchants(1))).resolves.toEqual(expected);
  });

  it("deduplicates keys before batching and uses the first display name", async () => {
    const { parse, classifier } = fakeClient();
    parse.mockResolvedValue(response([{ index: 0, category: "cafe" }]));
    const input = Array.from({ length: 450 }, (_, index) => ({
      merchantKey: "ONE-KEY", merchant: index === 0 ? "첫 번째 가맹점" : "다른 가맹점",
    }));
    await expect(classifier.classify(input)).resolves.toEqual(new Map([["ONE-KEY", "cafe"]]));
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse.mock.calls[0][0].messages).toEqual([{ role: "user", content: "0\t첫 번째 가맹점" }]);
  });

  it("returns an empty map without calling the SDK for empty input", async () => {
    const { parse, classifier } = fakeClient();
    await expect(classifier.classify([])).resolves.toEqual(new Map());
    expect(parse).not.toHaveBeenCalled();
  });
});
