import { describe, expect, it } from "vitest";
import { LOGIN_ERROR_MESSAGES, parseLoginErrorCode } from "./messages";

describe("parseLoginErrorCode", () => {
  it.each(["cancelled", "failed"] as const)("accepts %s", (code) => {
    expect(parseLoginErrorCode(code)).toBe(code);
  });

  it.each([
    { value: ["failed"] },
    { value: "FAILED" },
    { value: "x" },
    { value: undefined },
    { value: "" },
    { value: null },
    { value: 1 },
  ])("rejects an invalid search parameter: $value", ({ value }) => {
    expect(parseLoginErrorCode(value)).toBeNull();
  });
});

describe("LOGIN_ERROR_MESSAGES", () => {
  it.each([
    ["cancelled", "구글 로그인을 취소했어요. 계속하려면 다시 시도해 주세요."],
    ["failed", "로그인을 마치지 못했어요. 잠시 후 다시 시도해 주세요."],
  ] as const)("provides a calm retry message for %s", (code, message) => {
    expect(LOGIN_ERROR_MESSAGES[code]).toBe(message);
    expect(LOGIN_ERROR_MESSAGES[code]).toContain("다시 시도");
    expect(LOGIN_ERROR_MESSAGES[code]).not.toContain("!");
  });
});
