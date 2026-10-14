import { describe, expect, it } from "vitest";
import { responseError } from "./api-reply";

describe("responseError", () => {
  it("preserves INVALID_CARD from the card creation API", () => {
    expect(responseError({ error: { code: "INVALID_CARD" } })).toEqual({ code: "INVALID_CARD" });
  });

  it("preserves CARD_MISMATCH with its reason from the upload API", () => {
    expect(responseError({ error: { code: "CARD_MISMATCH", reason: "product" } }))
      .toEqual({ code: "CARD_MISMATCH", reason: "product" });
  });
});
