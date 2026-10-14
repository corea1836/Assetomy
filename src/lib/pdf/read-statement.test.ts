import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PdfTextItem } from "@/types/parsing";
import fixture from "@/lib/parsing/__fixtures__/hyundai-statement-pdf.items.json";
import { groupPdfRows } from "@/lib/parsing/pdf-rows";
import { parseHyundaiStatement } from "@/lib/parsing/profiles/hyundai-statement-pdf";
import { extractPdfTextItems } from "./extract";
import { readPdfStatement } from "./read-statement";
import { makeTestPdf, TEST_TEXT_STREAM } from "./test-pdf";

vi.mock("./extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./extract")>();
  return { ...actual, extractPdfTextItems: vi.fn(actual.extractPdfTextItems) };
});

afterEach(() => vi.mocked(extractPdfTextItems).mockReset());

describe("readPdfStatement", () => {
  it("rejects an extracted PDF without a supported profile", async () => {
    expect(await readPdfStatement(makeTestPdf([TEST_TEXT_STREAM]))).toEqual({
      ok: false, code: "UNSUPPORTED_FILE", reason: "unknown_format",
    });
  });

  it.each(["not_pdf", "encrypted", "too_many_pages", "no_text"] as const)("returns the extraction failure %s unchanged", async (reason) => {
    const failure = { ok: false, code: "UNSUPPORTED_FILE", reason } as const;
    vi.mocked(extractPdfTextItems).mockResolvedValueOnce(failure);
    expect(await readPdfStatement(new Uint8Array())).toBe(failure);
  });

  it("groups extracted fixture fragments and returns the profile result", async () => {
    const items: PdfTextItem[] = fixture;
    vi.mocked(extractPdfTextItems).mockResolvedValueOnce({ ok: true, items, savedAt: null });
    const bytes = makeTestPdf([TEST_TEXT_STREAM]);
    expect(await readPdfStatement(bytes)).toEqual(parseHyundaiStatement(groupPdfRows(items)));
    expect(extractPdfTextItems).toHaveBeenCalledWith(bytes);
  });

  it("passes PDF metadata through to the statement parser", async () => {
    const items: PdfTextItem[] = fixture;
    vi.mocked(extractPdfTextItems).mockResolvedValueOnce({
      ok: true, items, savedAt: "2026-10-13T22:39:44Z",
    });
    const result = await readPdfStatement(makeTestPdf([TEST_TEXT_STREAM]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a successfully parsed statement");
    expect(result.statement.savedAt).toBe("2026-10-13T22:39:44Z");
  });

  it("requires detection of the Hyundai marker before parsing", async () => {
    vi.mocked(extractPdfTextItems).mockResolvedValueOnce({ ok: true, savedAt: null, items: [
      { page: 1, x: 0, y: 700, str: "10월 23일 명세서" },
      { page: 1, x: 0, y: 600, str: "1,000원" },
    ] });
    expect(await readPdfStatement(new Uint8Array())).toEqual({
      ok: false, code: "UNSUPPORTED_FILE", reason: "unknown_format",
    });
  });

  it("returns a recognized profile's failure without correcting its total", async () => {
    const items = fixture.map((item) => ({
      ...item, str: item.str === "1,820,075" ? "1,820,076" : item.str,
    }));
    vi.mocked(extractPdfTextItems).mockResolvedValueOnce({ ok: true, items, savedAt: null });
    expect(await readPdfStatement(new Uint8Array())).toEqual({
      ok: false, code: "UNREADABLE", reason: "total_mismatch",
    });
  });

  it("propagates unexpected extraction errors", async () => {
    const error = new Error("EXTRACTION_FAILED");
    vi.mocked(extractPdfTextItems).mockRejectedValueOnce(error);
    await expect(readPdfStatement(new Uint8Array())).rejects.toBe(error);
  });
});

describe.skipIf(!process.env.ASSETOMY_SAMPLE_PDF)("readPdfStatement with a local sample", () => {
  it("matches the fixture's count, total and date/amount order", async () => {
    // 원본 경로나 가맹점이 실패 출력에 포함되지 않도록 원문 오류와 전체 결과를 출력하지 않는다.
    const bytes = await readFile(process.env.ASSETOMY_SAMPLE_PDF!).catch(() => {
      throw new Error("SAMPLE_PDF_READ_FAILED");
    });
    const result = await readPdfStatement(new Uint8Array(bytes)).catch(() => {
      throw new Error("SAMPLE_PDF_EXTRACTION_FAILED");
    });
    const expected = parseHyundaiStatement(groupPdfRows(fixture));
    expect(result.ok).toBe(true);
    expect(expected.ok).toBe(true);
    if (!result.ok || !expected.ok) throw new Error("Expected a successfully parsed sample");
    expect(result.transactions.length).toBe(78);
    expect(result.statementTotal).toBe(1_820_075);
    expect(result.transactions.map(({ date, amount }) => [date, amount]))
      .toEqual(expected.transactions.map(({ date, amount }) => [date, amount]));
    expect(result.statement.date).toBe("2026-10-23");
    expect(result.statement.productName).toBe("현대카드MM");
    expect(result.statement.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/);
  });
});
