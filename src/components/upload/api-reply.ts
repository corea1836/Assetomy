import { z } from "zod";
import type { ApiErrorBody } from "@/types/upload";

export type UploadError = ApiErrorBody["error"];
export const TEMPORARY_ERROR: UploadError = { code: "TEMPORARY_FAILURE" };
const errorSchema = z.object({ error: z.object({
  code: z.enum([
    "BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "INVALID_LABEL", "DUPLICATE_LABEL", "INVALID_CARD",
    "CARD_NOT_FOUND", "CARD_SCOPE_MISMATCH", "CARD_MISMATCH", "UPLOAD_PROCESSING", "FILE_TOO_LARGE",
    "UNSUPPORTED_FILE", "UNREADABLE", "RATE_LIMITED", "BUSY", "TEMPORARY_FAILURE",
  ]),
  reason: z.string().optional(),
}) });

export function responseError(body: unknown): UploadError {
  const parsed = errorSchema.safeParse(body);
  return parsed.success ? parsed.data.error : TEMPORARY_ERROR;
}

export async function fetchJson(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(url, init);
    return { status: response.status, body: await response.json() as unknown };
  } catch {
    return { status: 0, body: null };
  }
}
