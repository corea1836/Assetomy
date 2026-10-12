import { describe, expect, it } from "vitest";
import type { PdfTextItem } from "@/types/parsing";
import fixture from "./__fixtures__/hyundai-statement-pdf.items.json";
import { groupPdfRows, ROW_Y_TOLERANCE } from "./pdf-rows";

const fixtureItems: PdfTextItem[] = fixture;

describe("groupPdfRows with the anonymized Hyundai fixture", () => {
  it("returns 284 nonempty rows spanning all twelve pages", () => {
    const rows = groupPdfRows(fixtureItems);

    expect(rows).toHaveLength(284);
    expect([...new Set(rows.map((row) => row.page))]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(rows.every((row) => row.text.length > 0)).toBe(true);
  });

  it("reconstructs the first eight lines and groups the offset amount cells", () => {
    const rows = groupPdfRows(fixtureItems);

    expect(rows.slice(0, 8).map((row) => row.text)).toEqual([
      "10월 23일 명세서",
      "1,820,075원",
      "간편결제 내역 자세히 보려면? 상세 정보 보기",
      "최근순 고액순",
      "26. 10. 11 (일)",
      "한빛주유소50,000원",
      "일시불 현대카드MM",
      "적립 예정 750(1.5%)",
    ]);
    expect(rows[1].cells.map((cell) => cell.str)).toEqual(["1,820,075", "원"]);
  });

  it("preserves the transaction lines across the second and third page boundary", () => {
    const rows = groupPdfRows(fixtureItems);

    expect(rows.filter((row) => row.page === 2).slice(-3).map((row) => row.text)).toEqual([
      "ACME* CLOUD SUB30,131원",
      "(USD:22.00)",
      "일시불 현대카드MM",
    ]);
    expect(rows.find((row) => row.page === 3)?.text).toBe("적립 예정 451(1.5%)");
  });

  it("keeps only the two footer lines on the twelfth page", () => {
    expect(groupPdfRows(fixtureItems).filter((row) => row.page === 12).map((row) => row.text))
      .toEqual(["명세서 이용 안내", "맨 위로"]);
  });
});

describe("groupPdfRows", () => {
  it("removes private-use icons and empty fragments but preserves standalone spaces", () => {
    const items: PdfTextItem[] = [
      { page: 1, x: 0, y: 105, str: "\uE000\uF8FF" },
      { page: 1, x: 0, y: 100, str: "\uE001Acme*\uF8FE" },
      { page: 1, x: 10, y: 100, str: " " },
      { page: 1, x: 20, y: 100, str: "Cloud" },
      { page: 1, x: 30, y: 100, str: "" },
      { page: 1, x: 0, y: 90, str: " \t " },
    ];

    expect(groupPdfRows(items)).toEqual([
      {
        page: 1,
        y: 100,
        cells: [
          { x: 0, str: "Acme*" },
          { x: 10, str: " " },
          { x: 20, str: "Cloud" },
        ],
        text: "Acme* Cloud",
      },
    ]);
  });

  it.each([
    [4, ["AB"]],
    [5, ["A", "B"]],
  ] as const)("groups fragments with a y difference of %i", (difference, expected) => {
    expect(ROW_Y_TOLERANCE).toBe(4);
    const rows = groupPdfRows([
      { page: 1, x: 0, y: 100, str: "A" },
      { page: 1, x: 10, y: 100 - difference, str: "B" },
    ]);

    expect(rows.map((row) => row.text)).toEqual(expected);
    expect(rows[0].y).toBe(100);
  });

  it("compares y to the first fragment instead of chaining nearby fragments", () => {
    expect(groupPdfRows([
      { page: 1, x: 0, y: 100, str: "A" },
      { page: 1, x: 10, y: 97, str: "B" },
      { page: 1, x: 0, y: 94, str: "C" },
    ])).toEqual([
      { page: 1, y: 100, cells: [{ x: 0, str: "A" }, { x: 10, str: "B" }], text: "AB" },
      { page: 1, y: 94, cells: [{ x: 0, str: "C" }], text: "C" },
    ]);
  });

  it("sorts pages, rows and cells and never merges matching y across pages", () => {
    expect(groupPdfRows([
      { page: 2, x: 0, y: 100, str: "다음 쪽" },
      { page: 1, x: 30, y: 97, str: "끝" },
      { page: 1, x: 30, y: 90, str: "아래" },
      { page: 1, x: 20, y: 100, str: "가운데" },
      { page: 1, x: 10, y: 97, str: "처음" },
    ])).toEqual([
      {
        page: 1,
        y: 100,
        cells: [{ x: 10, str: "처음" }, { x: 20, str: "가운데" }, { x: 30, str: "끝" }],
        text: "처음가운데끝",
      },
      { page: 1, y: 90, cells: [{ x: 30, str: "아래" }], text: "아래" },
      { page: 2, y: 100, cells: [{ x: 0, str: "다음 쪽" }], text: "다음 쪽" },
    ]);
  });

  it("collapses and trims whitespace in text while retaining the cell strings", () => {
    expect(groupPdfRows([
      { page: 1, x: 10, y: 100, str: "  Acme*\t" },
      { page: 1, x: 20, y: 100, str: "\n  Cloud  " },
    ])).toEqual([
      {
        page: 1,
        y: 100,
        cells: [{ x: 10, str: "  Acme*\t" }, { x: 20, str: "\n  Cloud  " }],
        text: "Acme* Cloud",
      },
    ]);
  });

  it("does not modify the input array or any original fragment", () => {
    const items: PdfTextItem[] = [
      { page: 2, x: 0, y: 100, str: "\uE000다음 쪽" },
      { page: 1, x: 20, y: 100, str: "오른쪽" },
      { page: 1, x: 0, y: 100, str: "왼쪽" },
    ];
    const original = items.map((item) => ({ ...item }));
    items.forEach((item) => Object.freeze(item));
    Object.freeze(items);

    expect(groupPdfRows(items).map((row) => row.text)).toEqual(["왼쪽오른쪽", "다음 쪽"]);
    expect(items).toEqual(original);
  });

  it("returns no rows for an empty input", () => {
    expect(groupPdfRows([])).toEqual([]);
  });
});
