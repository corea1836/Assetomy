import { describe, expect, it } from "vitest";
import { PRO_PRICE_KRW, PRO_PRICE_USD_LABEL } from "./pricing";

describe("Pro pricing", () => {
  it("shares the temporary KRW price and overseas label", () => {
    expect(PRO_PRICE_KRW).toBe(6_900);
    expect(PRO_PRICE_USD_LABEL).toBe("$4.99/월");
  });
});
