import { describe, expect, it } from "vitest";
import { flowDirection } from "./flow";

describe("flowDirection", () => {
  it.each([
    [[100, 120, 150], "rising"],
    [[150, 120, 100], "falling"],
    [[100, 105, 98], "steady"],
    [[100, 150, 120], "mixed"],
    [[100, 100, 150], "mixed"],
    [[0, 0, 0], "steady"],
    [[100, 110], "steady"],
    [[100, 112], "rising"],
    [[-100, -80], "rising"],
  ] as const)("returns %s for %j", (values, expected) => {
    expect(flowDirection(values)).toBe(expected);
  });

  it("requires at least two values", () => {
    expect(() => flowDirection([1])).toThrow();
  });
});
