import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPdfTextItems, MAX_PDF_PAGES } from "./extract";
import { makeTestPdf, TEST_TEXT_STREAM } from "./test-pdf";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});

afterEach(() => vi.mocked(getDocument).mockReset());

describe("extractPdfTextItems with synthetic PDFs", () => {
  it.each(["", "hello", "%PDF", " %PDF-1.4"])("rejects a missing signature before loading: %j", async (text) => {
    expect(await extractPdfTextItems(new TextEncoder().encode(text))).toEqual({
      ok: false, code: "UNSUPPORTED_FILE", reason: "not_pdf",
    });
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("rejects invalid PDF bytes even when the signature is present", async () => {
    expect(await extractPdfTextItems(new TextEncoder().encode("%PDF-1.4 garbage"))).toEqual({
      ok: false, code: "UNSUPPORTED_FILE", reason: "not_pdf",
    });
  });

  it("extracts text and PDF coordinates without consuming the caller's bytes", async () => {
    const bytes = makeTestPdf([TEST_TEXT_STREAM]);
    const original = bytes.slice();
    const result = await extractPdfTextItems(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected extracted text");
    expect(result.items).toEqual(expect.arrayContaining([
      { page: 1, x: 72, y: 700, str: "HELLO" },
      { page: 1, x: 272, y: 700, str: "1,000" },
    ]));
    expect(result.savedAt).toBeNull();
    expect(result.items.some((item) => item.str === "")).toBe(false);
    expect(bytes.byteLength).toBe(original.byteLength);
    expect(bytes).toEqual(original);
  });

  it("extracts and normalizes the PDF CreationDate metadata", async () => {
    const result = await extractPdfTextItems(makeTestPdf([TEST_TEXT_STREAM], false, {
      creationDate: "D:20261013223944Z00'00'",
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected extracted text");
    expect(result.savedAt).toBe("2026-10-13T22:39:44Z");
  });

  it("numbers pages from one and retains their own coordinates", async () => {
    const result = await extractPdfTextItems(makeTestPdf([
      TEST_TEXT_STREAM, "BT /F1 12 Tf 40 600 Td (SECOND) Tj ET",
    ]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected extracted text");
    expect(result.items).toContainEqual({ page: 2, x: 40, y: 600, str: "SECOND" });
  });

  it.each(["", "BT /F1 12 Tf 72 700 Td (   ) Tj ET"])("rejects an empty or whitespace-only page: %j", async (stream) => {
    expect(await extractPdfTextItems(makeTestPdf([stream]))).toEqual({
      ok: false, code: "UNSUPPORTED_FILE", reason: "no_text",
    });
  });

  it("rejects 101 pages before examining text", async () => {
    expect(MAX_PDF_PAGES).toBe(100);
    expect(await extractPdfTextItems(makeTestPdf(Array.from({ length: 101 }, () => "")))).toEqual({
      ok: false, code: "UNSUPPORTED_FILE", reason: "too_many_pages",
    });
  });

  it("rejects password-protected PDFs", async () => {
    expect(await extractPdfTextItems(makeTestPdf([TEST_TEXT_STREAM], true))).toEqual({
      ok: false, code: "UNSUPPORTED_FILE", reason: "encrypted",
    });
  });
});

function mockLoadingTask(promise: Promise<unknown>) {
  const destroy = vi.fn().mockResolvedValue(undefined);
  vi.mocked(getDocument).mockReturnValueOnce({ promise, destroy } as unknown as ReturnType<typeof getDocument>);
  return destroy;
}

describe("extractPdfTextItems resource and error boundaries", () => {
  it("uses package-local fonts, CMaps and worker, safe options and a copied buffer", async () => {
    const getTextContent = vi.fn().mockResolvedValue({ items: [
      { str: "HELLO", transform: [1, 0, 0, 1, 72, 700] },
      { str: "", transform: [1, 0, 0, 1, 100, 700] },
      { str: " ", transform: [1, 0, 0, 1, 200, 700] },
      { type: "beginMarkedContent" },
    ] });
    const destroy = mockLoadingTask(Promise.resolve({
      numPages: 1, getPage: vi.fn().mockResolvedValue({ getTextContent }),
    }));
    const bytes = makeTestPdf([TEST_TEXT_STREAM]);
    expect(await extractPdfTextItems(bytes)).toEqual({ ok: true, items: [
      { page: 1, x: 72, y: 700, str: "HELLO" },
      { page: 1, x: 200, y: 700, str: " " },
    ], savedAt: null });

    const packageDir = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
    const options = vi.mocked(getDocument).mock.calls[0][0];
    expect(options).toMatchObject({
      data: bytes,
      cMapUrl: `${join(packageDir, "cmaps")}/`,
      standardFontDataUrl: `${join(packageDir, "standard_fonts")}/`,
      cMapPacked: true, isEvalSupported: false, disableFontFace: true,
      useSystemFonts: false, verbosity: 0,
    });
    if (!options || typeof options !== "object" || !("data" in options)) {
      throw new Error("Expected PDF initialization options");
    }
    expect(options.data).not.toBe(bytes);
    expect((options.data as Uint8Array).buffer).not.toBe(bytes.buffer);
    expect(GlobalWorkerOptions.workerSrc).toBe(join(packageDir, "legacy/build/pdf.worker.mjs"));
    expect(destroy).toHaveBeenCalledOnce();
  });

  it.each([
    ["PasswordException", "encrypted"],
    ["InvalidPDFException", "not_pdf"],
  ])("cleans up loading failures named %s", async (name, reason) => {
    const destroy = mockLoadingTask(Promise.reject(Object.assign(new Error("LOAD_FAILED"), { name })));
    expect(await extractPdfTextItems(makeTestPdf([""]))).toEqual({
      ok: false, code: "UNSUPPORTED_FILE", reason,
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("cleans up and rethrows other loading errors such as a missing worker", async () => {
    // 워커 파일이 번들에서 빠지면 pdfjs는 일반 Error를 던진다. 파일 문제(422)가 아니라 장애로 올려야 한다.
    const error = new Error("Setting up fake worker failed");
    const destroy = mockLoadingTask(Promise.reject(error));
    await expect(extractPdfTextItems(makeTestPdf([""]))).rejects.toBe(error);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("cleans up too many pages without reading any page", async () => {
    const getPage = vi.fn();
    const destroy = mockLoadingTask(Promise.resolve({ numPages: 101, getPage }));
    expect(await extractPdfTextItems(makeTestPdf([""]))).toEqual({
      ok: false, code: "UNSUPPORTED_FILE", reason: "too_many_pages",
    });
    expect(getPage).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("allows exactly 100 pages and cleans up a no-text result", async () => {
    const getPage = vi.fn().mockResolvedValue({
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
    });
    const destroy = mockLoadingTask(Promise.resolve({ numPages: 100, getPage }));
    expect(await extractPdfTextItems(makeTestPdf([""]))).toEqual({
      ok: false, code: "UNSUPPORTED_FILE", reason: "no_text",
    });
    expect(getPage).toHaveBeenCalledTimes(100);
    expect(getPage).toHaveBeenNthCalledWith(100, 100);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("continues with null savedAt when PDF metadata cannot be read", async () => {
    const getMetadata = vi.fn().mockRejectedValue(new Error("METADATA_FAILED"));
    const getTextContent = vi.fn().mockResolvedValue({
      items: [{ str: "HELLO", transform: [1, 0, 0, 1, 72, 700] }],
    });
    mockLoadingTask(Promise.resolve({
      numPages: 1,
      getMetadata,
      getPage: vi.fn().mockResolvedValue({ getTextContent }),
    }));

    expect(await extractPdfTextItems(makeTestPdf([TEST_TEXT_STREAM]))).toEqual({
      ok: true, savedAt: null, items: [{ page: 1, x: 72, y: 700, str: "HELLO" }],
    });
  });

  it.each(["getPage", "getTextContent"])("cleans up and rethrows unexpected %s errors", async (method) => {
    // 같은 에러 이름이어도 페이지 처리 오류는 로딩 실패로 분류하지 않는다.
    const error = Object.assign(new Error("PAGE_FAILED"), { name: "PasswordException" });
    const getPage = method === "getPage"
      ? vi.fn().mockRejectedValue(error)
      : vi.fn().mockResolvedValue({ getTextContent: vi.fn().mockRejectedValue(error) });
    const destroy = mockLoadingTask(Promise.resolve({ numPages: 1, getPage }));
    await expect(extractPdfTextItems(makeTestPdf([""]))).rejects.toBe(error);
    expect(destroy).toHaveBeenCalledOnce();
  });
});
