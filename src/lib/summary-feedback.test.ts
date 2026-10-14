import { describe, expect, it } from "vitest";
import { feedbackLength, normalizeFeedback } from "./summary-feedback";

describe("summary feedback text", () => {
  it("collapses spaces, tabs and line breaks to one space", () => {
    expect(normalizeFeedback("평일\n\t오전   커피")).toBe("평일 오전 커피");
  });

  it("trims whitespace at both ends", () => {
    expect(normalizeFeedback("  평일 오전 커피  ")).toBe("평일 오전 커피");
  });

  it("counts Unicode code points like PostgreSQL char_length", () => {
    expect(feedbackLength("👍")).toBe(1);
    expect(feedbackLength("한글👍")).toBe(3);
  });
});
