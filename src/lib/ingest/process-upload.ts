import "server-only";
import { sha256Hex } from "@/lib/crypto";
import { retentionCutoff } from "@/lib/retention";
import type { MerchantClassifier, MerchantInput } from "@/services/llm/types";
import type { CategoryId } from "@/types/category";
import type { ParseResult } from "@/types/parsing";
import type { IsoDate } from "@/types/transaction";
import type {
  BeginUploadInput, BeginUploadResult, FailUploadResult, IngestUploadInput, IngestUploadResult,
  ProcessUploadInput, ProcessUploadOutcome, UploadOutcomeRecord,
} from "@/types/upload";
import { transactionFingerprint } from "./fingerprint";

// 카드사 항목은 분류기에 묻지 않고 정해 둔다. 사용자 수정값·기존 거래의 카테고리가 있으면 그쪽이 먼저다.
const FIXED_CATEGORIES = new Map<string, CategoryId>([["연회비", "finance"]]);

export type ProcessUploadDeps = {
  today: IsoDate;
  beginUpload(input: BeginUploadInput): Promise<BeginUploadResult>;
  saveStatement(userId: string, uploadId: string, plaintext: Uint8Array): Promise<void>;
  readStatement(bytes: Uint8Array): Promise<ParseResult>;
  findMerchantCategories(merchantKeys: string[]): Promise<Map<string, CategoryId>>;
  classifier: MerchantClassifier;
  ingestUpload(input: IngestUploadInput): Promise<IngestUploadResult>;
  failUpload(userId: string, uploadId: string, code: string, reason?: string): Promise<FailUploadResult>;
  getUploadOutcome(uploadId: string): Promise<UploadOutcomeRecord | null>;
};

export async function processUpload(
  input: ProcessUploadInput, deps: ProcessUploadDeps,
): Promise<ProcessUploadOutcome> {
  const { userId, fileName, bytes } = input;
  const cardId = input.cardId.toLowerCase();
  let begin: BeginUploadResult;
  try {
    begin = await deps.beginUpload({
      userId, cardId, fileName, fileHash: sha256Hex(bytes), fileSize: bytes.byteLength,
    });
  } catch {
    return { kind: "temporary_failure", uploadId: null };
  }
  if (begin.kind !== "started") return begin;
  const { uploadId } = begin;

  async function finishFailure(code: string, reason: string): Promise<void> {
    try {
      await deps.failUpload(userId, uploadId, code, reason);
    } catch {
      // The lease cleanup will end the upload if failure recording is unavailable.
    }
  }

  try {
    await deps.saveStatement(userId, uploadId, bytes);
  } catch {
    await finishFailure("INTERNAL_ERROR", "storage");
    return { kind: "temporary_failure", uploadId };
  }

  let parsed: ParseResult;
  try {
    parsed = await deps.readStatement(bytes);
  } catch {
    await finishFailure("INTERNAL_ERROR", "parser");
    return { kind: "temporary_failure", uploadId };
  }
  if (!parsed.ok) {
    await finishFailure(parsed.code, parsed.reason);
    if (parsed.code === "UNSUPPORTED_FILE") {
      return { kind: "rejected", uploadId, code: parsed.code, reason: parsed.reason };
    }
    return { kind: "rejected", uploadId, code: parsed.code, reason: parsed.reason };
  }

  const cutoff = retentionCutoff(deps.today);
  const transactions = parsed.transactions.filter((transaction) => transaction.date >= cutoff);
  const skipped = parsed.transactions.length - transactions.length;
  const merchants = new Map<string, MerchantInput>();
  for (const { merchantKey, merchant } of transactions) {
    if (!merchants.has(merchantKey)) merchants.set(merchantKey, { merchantKey, merchant });
  }

  let categories: Map<string, CategoryId>;
  try {
    categories = await deps.findMerchantCategories([...merchants.keys()]);
  } catch {
    await finishFailure("INTERNAL_ERROR", "categories");
    return { kind: "temporary_failure", uploadId };
  }

  const missing = [...merchants.values()]
    .filter(({ merchantKey }) => !categories.has(merchantKey) && !FIXED_CATEGORIES.has(merchantKey));
  let classified = new Map<string, CategoryId>();
  if (missing.length) {
    try {
      classified = await deps.classifier.classify(missing);
    } catch {
      // Classification failures do not prevent deterministic transaction storage.
    }
  }
  const rows = transactions.map((transaction) => ({
    usedOn: transaction.date, merchant: transaction.merchant, merchantKey: transaction.merchantKey,
    amount: transaction.amount, eventKind: transaction.eventKind,
    category: categories.get(transaction.merchantKey) ?? FIXED_CATEGORIES.get(transaction.merchantKey)
      ?? classified.get(transaction.merchantKey) ?? "etc",
    fingerprint: transactionFingerprint({ cardId, identityScope: parsed.identityScope,
      sourceEventKey: transaction.sourceEventKey, eventKind: transaction.eventKind }),
  }));

  async function recoverOutcome(): Promise<ProcessUploadOutcome> {
    try {
      const record = await deps.getUploadOutcome(uploadId);
      if (record?.status === "done" || record?.status === "no_new") {
        const { status, ...summary } = record;
        return { kind: status, uploadId, ...summary };
      }
    } catch {
      // An ambiguous commit must preserve the upload, including completed rows.
    }
    return { kind: "temporary_failure", uploadId };
  }

  let result: IngestUploadResult;
  try {
    result = await deps.ingestUpload({
      userId, uploadId, identityScope: parsed.identityScope, cancelStyle: parsed.cancelStyle, rows, skipped,
    });
  } catch {
    return recoverOutcome();
  }
  switch (result.kind) {
    case "done":
    case "no_new":
      return { ...result, uploadId };
    case "duplicate":
      return result;
    case "card_scope_mismatch":
      return { kind: result.kind, uploadId };
    case "not_processing":
      return recoverOutcome();
    case "lease_expired":
    case "not_found":
      return { kind: "temporary_failure", uploadId };
  }
}
