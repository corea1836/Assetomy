import "server-only";

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ParseFailure, PdfTextItem } from "@/types/parsing";

export const MAX_PDF_PAGES = 100;

export type PdfExtraction =
  | { ok: true; items: PdfTextItem[] }
  | Extract<ParseFailure, { code: "UNSUPPORTED_FILE" }>;

const packageDir = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
GlobalWorkerOptions.workerSrc = join(packageDir, "legacy/build/pdf.worker.mjs");

export async function extractPdfTextItems(bytes: Uint8Array): Promise<PdfExtraction> {
  if (
    bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 ||
    bytes[3] !== 0x46 || bytes[4] !== 0x2d
  ) {
    return { ok: false, code: "UNSUPPORTED_FILE", reason: "not_pdf" };
  }

  const options = {
    // 워커가 버퍼를 가져가도 호출자는 해시·암호화에 원본 바이트를 쓸 수 있다.
    data: bytes.slice(),
    cMapUrl: `${join(packageDir, "cmaps")}/`,
    standardFontDataUrl: `${join(packageDir, "standard_fonts")}/`,
    cMapPacked: true,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  };
  const loadingTask = getDocument(options);
  try {
    let document: PDFDocumentProxy;
    try {
      document = await loadingTask.promise;
    } catch (error) {
      const encrypted = typeof error === "object" && error !== null &&
        "name" in error && error.name === "PasswordException";
      return {
        ok: false, code: "UNSUPPORTED_FILE", reason: encrypted ? "encrypted" : "not_pdf",
      };
    }

    if (document.numPages > MAX_PDF_PAGES) {
      return { ok: false, code: "UNSUPPORTED_FILE", reason: "too_many_pages" };
    }

    const items: PdfTextItem[] = [];
    for (let page = 1; page <= document.numPages; page += 1) {
      const pdfPage = await document.getPage(page);
      const content = await pdfPage.getTextContent();
      for (const item of content.items) {
        if ("str" in item && item.str !== "") {
          items.push({ page, x: item.transform[4], y: item.transform[5], str: item.str });
        }
      }
    }

    if (!items.some((item) => item.str.trim() !== "")) {
      return { ok: false, code: "UNSUPPORTED_FILE", reason: "no_text" };
    }
    return { ok: true, items };
  } finally {
    await loadingTask.destroy();
  }
}
