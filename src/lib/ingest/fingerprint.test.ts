import { describe, expect, it } from "vitest";
import type { IdentityScope } from "@/types/parsing";
import { transactionFingerprint } from "./fingerprint";

const input = {
  cardId: "abcdef01-2345-4678-9abc-def012345678",
  identityScope: "content" as const,
  sourceEventKey: "2026-09-01|스타벅스|5500|0",
  eventKind: "purchase" as const,
};

describe("transactionFingerprint", () => {
  it("hashes the exact UTF-8 fields with pipe separators", () => {
    // Independently calculated with Python hashlib.sha256, including the Korean key.
    expect(transactionFingerprint(input)).toBe(
      "e6738652c9a9beafb0f9fa1ab34486e0240b7d9cb029ec79ab1032f922dec8ca",
    );
  });

  it.each([
    input.cardId.toUpperCase(), "not-a-uuid", "", input.cardId.replaceAll("-", ""),
    ` ${input.cardId}`, `${input.cardId}\n`, "gbcdef01-2345-4678-9abc-def012345678",
  ])("rejects a card ID that is not a lowercase UUID: %j", (cardId) => {
    expect(() => transactionFingerprint({ ...input, cardId })).toThrow();
  });

  it("changes when any identity field changes", () => {
    const original = transactionFingerprint(input);
    for (const change of [
      { cardId: "abcdef02-2345-4678-9abc-def012345678" },
      // The current parser exposes only content; a future scope still belongs in the hash.
      { identityScope: "approval_number" as IdentityScope },
      { sourceEventKey: "2026-09-01|스타벅스|5500|1" },
      { eventKind: "cancel" as const },
    ]) {
      expect(transactionFingerprint({ ...input, ...change })).not.toBe(original);
    }
  });
});
