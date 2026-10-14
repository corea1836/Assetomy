import { describe, expect, it } from "vitest";
import type { CardOption } from "@/types/upload";
import { nextCardLabel } from "./next-card-label";

describe("nextCardLabel", () => {
  it("starts with the issuer's first label when there are no cards", () => {
    expect(nextCardLabel("hyundai", [])).toBe("현대카드 1");
  });

  it("starts after the number of cards from the same issuer", () => {
    const cards: CardOption[] = [
      { id: "a", label: "생활비", issuer: "hyundai", analysisBasis: "month", cycleStartDay: null },
    ];
    expect(nextCardLabel("hyundai", cards)).toBe("현대카드 2");
  });

  it("skips labels already used by any issuer", () => {
    const cards: CardOption[] = [
      { id: "a", label: "생활비", issuer: "hyundai", analysisBasis: "month", cycleStartDay: null },
      { id: "b", label: "현대카드 2", issuer: "shinhan", analysisBasis: "month", cycleStartDay: null },
    ];
    expect(nextCardLabel("hyundai", cards)).toBe("현대카드 3");
  });

  it("uses the Korean label for other issuers", () => {
    expect(nextCardLabel("kb", [])).toBe("KB국민카드 1");
  });
});
