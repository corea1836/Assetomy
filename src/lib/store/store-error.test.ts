import { describe, expect, it } from "vitest";
import { StoreError } from "./store-error";

describe("StoreError", () => {
  it("contains only the operation and code with a predictable message", () => {
    const error = new StoreError("ingest_upload", "23514");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("store:ingest_upload:23514");
    expect(String(error)).toContain("store:ingest_upload:23514");
    expect(JSON.parse(JSON.stringify(error))).toEqual({ operation: "ingest_upload", code: "23514" });
    expect(error).not.toHaveProperty("cause");
  });
});
