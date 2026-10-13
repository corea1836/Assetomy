import { describe, expect, it } from "vitest";
import { RETENTION_MONTHS, retentionCutoff } from "./retention";

describe("retentionCutoff", () => {
  it("retains twelve months", () => {
    expect(RETENTION_MONTHS).toBe(12);
  });

  it.each([
    ["2026-10-13", "2025-10-13"],
    ["2026-03-31", "2025-03-31"],
    ["2028-02-29", "2027-02-28"],
    ["2026-01-05", "2025-01-05"],
  ])("%s → %s", (today, expected) => {
    expect(retentionCutoff(today)).toBe(expected);
  });
});
