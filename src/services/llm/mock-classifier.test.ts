import "server-only";
import { describe, expect, it, vi } from "vitest";
import { normalizeMerchantKey } from "@/lib/parsing/normalize";
import { createMockClassifier } from "./mock-classifier";

describe("createMockClassifier", () => {
  it.each([
    ["스타벅스", "cafe"], ["커피", "cafe"], ["카페", "cafe"],
    ["배달의민족", "delivery"], ["쿠팡이츠", "delivery"], ["요기요", "delivery"],
    ["택시", "transport"], ["지하철", "transport"], ["버스", "transport"], ["코레일", "transport"],
    ["이마트", "grocery"], ["홈플러스", "grocery"], ["롯데마트", "grocery"],
    ["GS25", "grocery"], ["CU", "grocery"], ["세븐일레븐", "grocery"],
    ["넷플릭스", "subscription"], ["NETFLIX", "subscription"], ["유튜브", "subscription"],
    ["YOUTUBE", "subscription"], ["SPOTIFY", "subscription"],
    ["쿠팡", "shopping"], ["무신사", "shopping"],
    ["병원", "health"], ["약국", "health"], ["의원", "health"],
    ["CGV", "culture"], ["메가박스", "culture"],
    ["호텔", "travel"], ["항공", "travel"],
    ["통신", "housing"], ["관리비", "housing"], ["보험", "finance"],
    ["학원", "education"], ["식당", "food"], ["김밥", "food"],
  ] as const)("classifies a key containing %s as %s", async (keyword, category) => {
    const merchantKey = normalizeMerchantKey(`${keyword} 강남점`);
    // Classification uses the normalized key, not the display name.
    const result = await createMockClassifier().classify([{ merchantKey, merchant: "표시명" }]);
    expect(result).toEqual(new Map([[merchantKey, category]]));
  });

  it("uses the first matching rule", async () => {
    const result = await createMockClassifier().classify([
      { merchantKey: "쿠팡이츠", merchant: "쿠팡이츠" },
      { merchantKey: "커피 식당", merchant: "커피 식당" },
    ]);
    expect(result).toEqual(new Map([["쿠팡이츠", "delivery"], ["커피 식당", "cafe"]]));
  });

  it("returns etc for an unknown merchant", async () => {
    await expect(createMockClassifier().classify([
      { merchantKey: "알 수 없는 가맹점", merchant: "스타벅스" },
    ])).resolves.toEqual(new Map([["알 수 없는 가맹점", "etc"]]));
  });

  it("classifies a duplicate key only once", async () => {
    const includes = vi.spyOn(String.prototype, "includes");
    try {
      const result = await createMockClassifier().classify([
        { merchantKey: "스타벅스", merchant: "첫 번째" },
        { merchantKey: "스타벅스", merchant: "두 번째" },
      ]);
      const keyChecks = includes.mock.contexts.filter((context) => String(context) === "스타벅스");
      expect(keyChecks).toHaveLength(1);
      expect(result).toEqual(new Map([["스타벅스", "cafe"]]));
    } finally {
      includes.mockRestore();
    }
  });

  it("returns an empty map for empty input", async () => {
    await expect(createMockClassifier().classify([])).resolves.toEqual(new Map());
  });
});
