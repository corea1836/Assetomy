import { describe, expect, it } from "vitest";
import { responseError } from "./api-reply";

describe("responseError", () => {
  it("preserves INVALID_CARD from the card creation API", () => {
    expect(responseError({ error: { code: "INVALID_CARD" } })).toEqual({ code: "INVALID_CARD" });
  });
});
