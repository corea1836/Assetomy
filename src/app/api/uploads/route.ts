import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { seoulToday } from "@/lib/clock";
import { apiError, checkMutationRequest } from "@/lib/http";
import { processUpload } from "@/lib/ingest/process-upload";
import { readPdfStatement } from "@/lib/pdf/read-statement";
import { listCards } from "@/lib/queries/cards";
import { findMerchantCategories } from "@/lib/queries/merchant-categories";
import { getUploadOutcome } from "@/lib/queries/uploads";
import { saveStatement } from "@/lib/store/statements";
import { beginUpload, failUpload, ingestUpload } from "@/lib/store/uploads";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMerchantClassifier } from "@/services/llm";
import type { UploadResponse } from "@/types/upload";

export const maxDuration = 300;
const MAX_FILE_BYTES = 4_194_304;
const MULTIPART_OVERHEAD_BYTES = 65_536;
const cardIdSchema = z.uuid();

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getSessionUser();
    if (!user) return apiError(401, "UNAUTHORIZED");
    const invalidRequest = checkMutationRequest(request, "multipart/form-data");
    if (invalidRequest) return invalidRequest;
    const contentLength = request.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) > MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES) {
      return apiError(422, "FILE_TOO_LARGE");
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiError(400, "BAD_REQUEST");
    }
    const cardId = cardIdSchema.safeParse(form.get("cardId"));
    const file = form.get("file");
    if (!cardId.success || !(file instanceof File)) return apiError(400, "BAD_REQUEST");
    if (file.size === 0) return apiError(422, "UNSUPPORTED_FILE", "empty_file");
    if (file.size > MAX_FILE_BYTES) return apiError(422, "FILE_TOO_LARGE");

    let fileName = file.name.trim() || "statement.pdf";
    if (!fileName.toLowerCase().endsWith(".pdf")) return apiError(422, "UNSUPPORTED_FILE", "not_pdf");
    if (fileName.length > 255) fileName = fileName.slice(0, 251) + fileName.slice(-4);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const supabase = await createSupabaseServerClient();
    const outcome = await processUpload({ userId: user.id, cardId: cardId.data, fileName, bytes }, {
      today: seoulToday(), beginUpload, ingestUpload, failUpload, saveStatement,
      readStatement: readPdfStatement, classifier: getMerchantClassifier(),
      findMerchantCategories: (keys) => findMerchantCategories(supabase, user.id, keys),
      getUploadOutcome: (id) => getUploadOutcome(supabase, user.id, id),
    });

    switch (outcome.kind) {
      case "done":
      case "no_new":
        return Response.json({ result: outcome } satisfies UploadResponse);
      case "duplicate": {
        let existingCardLabel: string | null = null;
        try {
          const cards = await listCards(supabase, user.id);
          existingCardLabel = cards.find((card) => card.id === outcome.existingCardId)?.label ?? null;
        } catch {
          // A label lookup failure does not change the duplicate result.
        }
        return Response.json({ result: { kind: "duplicate", existingCardLabel } } satisfies UploadResponse);
      }
      case "rejected":
        return apiError(422, outcome.code, outcome.reason);
      case "card_not_found":
        return apiError(404, "CARD_NOT_FOUND");
      case "card_scope_mismatch":
        return apiError(409, "CARD_SCOPE_MISMATCH");
      case "rate_limited":
        return apiError(429, "RATE_LIMITED");
      case "busy":
        return apiError(429, "BUSY");
      case "temporary_failure":
        console.error("upload:temporary_failure", outcome.uploadId ?? "-");
        return apiError(503, "TEMPORARY_FAILURE");
    }
  } catch (error) {
    console.error(`upload:${error instanceof Error ? error.constructor.name : "UnknownError"}`, "-");
    return apiError(503, "TEMPORARY_FAILURE");
  }
}
