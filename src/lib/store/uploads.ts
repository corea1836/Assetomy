import "server-only";
import { z } from "zod";
import type {
  BeginUploadInput, BeginUploadResult, DeleteUploadResult,
  FailUploadResult, IngestUploadInput, IngestUploadResult,
} from "@/types/upload";
import { callStoreRpc } from "./store-error";

const duplicateSchema = z.object({ kind: z.literal("duplicate"), existing_card_id: z.uuid() })
  .transform((result) => ({ kind: result.kind, existingCardId: result.existing_card_id }));
const notFoundSchema = z.object({ kind: z.literal("not_found") });
const notProcessingSchema = z.object({
  kind: z.literal("not_processing"),
  status: z.enum(["processing", "done", "no_new", "failed"]),
});
const cardMismatchSchema = z.object({
  kind: z.literal("card_mismatch"), reason: z.enum(["issuer", "product"]),
});

const beginUploadResultSchema = z.union([
  z.object({ kind: z.literal("started"), upload_id: z.uuid(), lease_expires_at: z.iso.datetime({ offset: true }) })
    .transform((result) => ({ kind: result.kind, uploadId: result.upload_id, leaseExpiresAt: result.lease_expires_at })),
  duplicateSchema,
  z.object({ kind: z.literal("card_not_found") }),
  z.object({ kind: z.literal("rate_limited") }),
  z.object({ kind: z.literal("busy") }),
]);

const ingestUploadResultSchema = z.union([
  z.object({
    kind: z.enum(["done", "no_new"]),
    inserted: z.int().nonnegative(),
    duplicates: z.int().nonnegative(),
    skipped: z.int().nonnegative(),
    period_from: z.iso.date().nullable(),
    period_to: z.iso.date().nullable(),
    net_amount: z.int(),
    statement_date: z.iso.date().nullable(),
    replaced_upload_id: z.uuid().nullable(),
  }).transform((result) => ({
    kind: result.kind, inserted: result.inserted, duplicates: result.duplicates, skipped: result.skipped,
    periodFrom: result.period_from, periodTo: result.period_to, netAmount: result.net_amount,
    statementDate: result.statement_date, replacedUploadId: result.replaced_upload_id,
  })),
  cardMismatchSchema,
  z.object({ kind: z.literal("older_statement") }),
  duplicateSchema,
  notFoundSchema,
  notProcessingSchema,
  z.object({ kind: z.literal("lease_expired") }),
  z.object({ kind: z.literal("card_scope_mismatch") }),
]);

const failUploadResultSchema = z.union([
  z.object({ kind: z.literal("failed") }), notFoundSchema, notProcessingSchema,
]);
const deleteUploadResultSchema = z.union([
  z.object({ kind: z.literal("deleted") }), notFoundSchema,
  z.object({ kind: z.literal("processing") }),
]);

export async function beginUpload(input: BeginUploadInput): Promise<BeginUploadResult> {
  return callStoreRpc("begin_upload", {
    p_user_id: input.userId, p_card_id: input.cardId,
    p_file_name: input.fileName, p_file_hash: input.fileHash, p_file_size: input.fileSize,
  }, beginUploadResultSchema);
}

export async function ingestUpload(input: IngestUploadInput): Promise<IngestUploadResult> {
  return callStoreRpc("ingest_upload", {
    p_user_id: input.userId, p_upload_id: input.uploadId,
    p_identity_scope: input.identityScope, p_cancel_style: input.cancelStyle,
    p_issuer: input.issuer, p_product_name: input.productName, p_statement_date: input.statementDate,
    p_statement_saved_at: input.statementSavedAt,
    p_rows: input.rows.map((row) => ({
      used_on: row.usedOn, merchant: row.merchant, merchant_key: row.merchantKey,
      amount: row.amount, event_kind: row.eventKind, category: row.category, fingerprint: row.fingerprint,
    })),
    p_skipped: input.skipped,
  }, ingestUploadResultSchema);
}

export async function failUpload(
  userId: string, uploadId: string, code: string, reason?: string,
): Promise<FailUploadResult> {
  return callStoreRpc("fail_upload", {
    p_user_id: userId, p_upload_id: uploadId, p_code: code, p_reason: reason ?? null,
  }, failUploadResultSchema);
}

export async function deleteUpload(userId: string, uploadId: string): Promise<DeleteUploadResult> {
  return callStoreRpc("delete_upload", { p_user_id: userId, p_upload_id: uploadId }, deleteUploadResultSchema);
}
