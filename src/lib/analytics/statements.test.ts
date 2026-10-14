import { describe, expect, it } from "vitest";
import { statementCyclePeriod } from "./statements";

describe("statementCyclePeriod", () => {
  it.each([
    ["2026-10-23", 12, "2026-09-12", "2026-10-11"],
    ["2026-09-23", 12, "2026-08-12", "2026-09-11"],
    ["2026-10-14", 1, "2026-09-01", "2026-09-30"],
    ["2026-11-12", 29, "2026-09-29", "2026-10-28"],
    ["2026-01-05", 20, "2025-11-20", "2025-12-19"],
    ["2026-03-25", 31, "2026-01-31", "2026-02-27"],
    ["2026-10-12", 12, "2026-09-12", "2026-10-11"],
    ["2028-03-10", 30, "2028-01-30", "2028-02-28"],
  ] as const)("calculates %s with cycle start day %i", (statementDate, cycleStartDay, from, to) => {
    expect(statementCyclePeriod(statementDate, cycleStartDay)).toEqual({ from, to });
  });

  it.each([
    ["2026-04-12", 31, "2026-02-28", "2026-03-30"],
    ["2026-03-12", 31, "2026-01-31", "2026-02-27"],
  ] as const)("clamps a %i-day cycle start to the month length", (statementDate, cycleStartDay, from, to) => {
    expect(statementCyclePeriod(statementDate, cycleStartDay)).toEqual({ from, to });
  });
});
