import "server-only";

import { groupPdfRows } from "@/lib/parsing/pdf-rows";
import {
  detectHyundaiStatement,
  parseHyundaiStatement,
} from "@/lib/parsing/profiles/hyundai-statement-pdf";
import type { ParseResult } from "@/types/parsing";
import { extractPdfTextItems } from "./extract";

export async function readPdfStatement(bytes: Uint8Array): Promise<ParseResult> {
  const extraction = await extractPdfTextItems(bytes);
  if (!extraction.ok) return extraction;

  const rows = groupPdfRows(extraction.items);
  if (!detectHyundaiStatement(rows)) {
    return { ok: false, code: "UNSUPPORTED_FILE", reason: "unknown_format" };
  }
  return parseHyundaiStatement(rows);
}
