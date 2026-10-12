import { describe, expect, it } from "vitest";
import { FINDING_KIND_LABELS } from "@/components/dashboard/finding-labels";

describe("shared finding labels", () => {
  it("preserves the existing dashboard wording for every finding kind", () => {
    expect(FINDING_KIND_LABELS).toEqual({
      recurring: "정기결제로 보여요",
      duplicate: "중복 결제 의심",
      large: "고액 결제",
    });
  });
});
