import { afterEach, describe, expect, it, vi } from "vitest";
import { seoulToday } from "./clock";

afterEach(() => vi.useRealTimers());

describe("seoulToday", () => {
  it.each([
    ["2026-10-12T15:30:00Z", "2026-10-13"],
    ["2026-10-12T14:59:59Z", "2026-10-12"],
  ])("converts %s to the Seoul calendar date", (instant, expected) => {
    expect(seoulToday(new Date(instant))).toBe(expected);
  });

  it("uses the current time when no date is supplied", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T15:30:00Z"));
    expect(seoulToday()).toBe("2026-10-13");
  });
});
