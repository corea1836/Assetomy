import "server-only";
import { isAllowedOrigin } from "@/lib/origin";
import type { ApiErrorBody, ApiErrorCode } from "@/types/upload";

export function apiError(status: number, code: ApiErrorCode, reason?: string): Response {
  const body: ApiErrorBody = { error: { code, ...(reason === undefined ? {} : { reason }) } };
  return Response.json(body, { status });
}

export function checkMutationRequest(
  request: Request, mediaType: "application/json" | "multipart/form-data" | null,
): Response | null {
  if (!isAllowedOrigin(request.headers.get("origin"))) return apiError(403, "FORBIDDEN");
  if (mediaType !== null) {
    const actual = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (actual !== mediaType) return apiError(400, "BAD_REQUEST");
  }
  return null;
}
