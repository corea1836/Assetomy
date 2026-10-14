import { describe, expect, it } from "vitest";
import { contentEventKeys, normalizeMerchantKey, parseWonAmount } from "./normalize";

describe("normalizeMerchantKey", () => {
  it.each([
    [" Acme*  Cloud ＳＵＢ ", "ACME* CLOUD SUB"],
    ["오늘마트24R햇살점", "오늘마트24R햇살점"],
    ["\tAcme*\n Cloud\u3000ＳＵＢ\t", "ACME* CLOUD SUB"],
    ["  \t\n", ""],
  ])("normalizes %s without removing punctuation or internal spaces", (merchant, expected) => {
    expect(normalizeMerchantKey(merchant)).toBe(expected);
  });
});

describe("parseWonAmount", () => {
  it.each([
    ["1,820,075", 1_820_075],
    ["-12,000", -12_000],
    ["350", 350],
    ["1820075", 1_820_075],
    [" \t-12,000\n", -12_000],
    ["0", 0],
    ["9007199254740991", Number.MAX_SAFE_INTEGER],
    ["9,007,199,254,740,991", Number.MAX_SAFE_INTEGER],
    ["-9007199254740991", Number.MIN_SAFE_INTEGER],
  ] as const)("reads %s as a safe integer", (text, expected) => {
    expect(parseWonAmount(text)).toBe(expected);
  });

  it.each([
    "1,82,0",
    "12.5",
    "1,000원",
    "",
    " \t\n",
    "₩1,000",
    "+1,000",
    "−12,000",
    "1 000",
    "1,000,",
    "1234,567",
    "- 12,000",
    "1e3",
    "0x10",
    "１２３",
    "9007199254740992",
    "-9,007,199,254,740,992",
  ])("rejects ambiguous or unsafe amount %s", (text) => {
    expect(parseWonAmount(text)).toBeNull();
  });
});

describe("contentEventKeys", () => {
  it("counts occurrences independently for each date, merchant and signed amount", () => {
    const payment = {
      date: "2026-09-15",
      merchantKey: "ACME* CLOUD SUB",
      amount: 30_131,
    };
    const grocery = { ...payment, merchantKey: "오늘마트24R햇살점" };
    const rows = [
      payment,
      grocery,
      { ...payment },
      { ...payment, date: "2026-09-16" },
      { ...payment, amount: 30_000 },
      { ...payment, amount: -30_131 },
      { ...grocery },
      { ...payment },
    ];
    const original = rows.map((row) => ({ ...row }));
    const expected = [
      "2026-09-15|ACME*CLOUDSU|30131|0",
      "2026-09-15|오늘마트24R햇살점|30131|0",
      "2026-09-15|ACME*CLOUDSU|30131|1",
      "2026-09-16|ACME*CLOUDSU|30131|0",
      "2026-09-15|ACME*CLOUDSU|30000|0",
      "2026-09-15|ACME*CLOUDSU|-30131|0",
      "2026-09-15|오늘마트24R햇살점|30131|1",
      "2026-09-15|ACME*CLOUDSU|30131|2",
    ];

    expect(contentEventKeys(rows)).toEqual(expected);
    expect(contentEventKeys(rows)).toEqual(expected);
    expect(rows).toEqual(original);
  });

  it("returns no keys for an empty list", () => {
    expect(contentEventKeys([])).toEqual([]);
  });

  // 같은 명세서도 받을 때마다 긴 가맹점명이 잘리는 길이가 달라서(19·21·22자 vs 20자) 앞부분만 쓴다.
  it.each([
    ["ANTHROPIC* CLAUDE SUB", "ANTHROPIC* CLAUDE SU"],
    ["TBL* MULTIPLAYER SURVI", "TBL* MULTIPLAYER SUR"],
    ["(주)결제대행 - 결제가게 햇살마을점", "(주)결제대행 - 결제가게 햇살마을점포"],
  ])("gives differently truncated names of one merchant the same key: %s", (left, right) => {
    const row = { date: "2026-10-06", amount: 30_131 };
    expect(contentEventKeys([{ ...row, merchantKey: left }]))
      .toEqual(contentEventKeys([{ ...row, merchantKey: right }]));
  });

  it("uses the first twelve non-space characters and counts merchants sharing them together", () => {
    const row = { date: "2026-10-06", amount: 2_000 };
    expect(contentEventKeys([
      { ...row, merchantKey: "(주)결제대행 - 결제가게 햇살마을점" },
      { ...row, merchantKey: "(주)결제대행 - 결제가게 달빛점" },
      { ...row, merchantKey: "QS25" },
    ])).toEqual([
      "2026-10-06|(주)결제대행-결제가게|2000|0",
      "2026-10-06|(주)결제대행-결제가게|2000|1",
      "2026-10-06|QS25|2000|0",
    ]);
  });
});
