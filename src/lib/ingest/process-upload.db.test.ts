import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptStatement } from "@/lib/crypto";
import { contentEventKeys, normalizeMerchantKey } from "@/lib/parsing/normalize";
import { findMerchantCategories } from "@/lib/queries/merchant-categories";
import { QueryError } from "@/lib/queries/query-error";
import { getUploadOutcome } from "@/lib/queries/uploads";
import { createCard } from "@/lib/store/cards";
import { STATEMENTS_BUCKET, removeStatements, saveStatement, statementPath } from "@/lib/store/statements";
import { StoreError } from "@/lib/store/store-error";
import { beginUpload, failUpload, ingestUpload } from "@/lib/store/uploads";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createTestUser, deleteTestUser } from "@/lib/supabase/db-test-helpers";
import { createMockClassifier } from "@/services/llm/mock-classifier";
import type { ParseSuccess } from "@/types/parsing";
import { transactionFingerprint } from "./fingerprint";
import { processUpload, type ProcessUploadDeps } from "./process-upload";

const key = randomBytes(32);
const bytes = new TextEncoder().encode("%PDF-synthetic-ingest");
const baseTransactions = [
  { date: "2025-10-12", merchant: "보관 기한 밖 가맹점", amount: 900 },
  { date: "2025-10-13", merchant: "스타벅스 강남", amount: 5500 },
  { date: "2026-09-02", merchant: "스타벅스 사용자 수정", amount: 20000 },
  { date: "2026-09-03", merchant: "예시 미분류 가맹점", amount: 1234 },
].map((transaction) => ({ ...transaction, merchantKey: normalizeMerchantKey(transaction.merchant) }));
const sourceEventKeys = contentEventKeys(baseTransactions);
const parsed: ParseSuccess = {
  ok: true, profile: "hyundai_statement_pdf", issuer: "hyundai", identityScope: "content", cancelStyle: "negative_amount",
  statementTotal: baseTransactions.reduce((total, transaction) => total + transaction.amount, 0),
  statement: { date: "2026-10-23", productName: "현대카드MM", savedAt: null },
  transactions: baseTransactions.map((transaction, index) => ({
    ...transaction, eventKind: "purchase", sourceEventKey: sourceEventKeys[index],
  })),
};

let userId: string | undefined;
let cardId: string;
let paths: string[] = [];
let diagnostics: Error[] = [];

beforeEach(async () => {
  userId = undefined;
  paths = [];
  diagnostics = [];
  vi.stubEnv("FILE_ENCRYPTION_KEY", key.toString("base64"));
  userId = (await createTestUser()).id;
  const card = await createCard(userId, "생활비 카드");
  if (card.kind !== "created") throw new Error("db-test:create_card:unexpected_response");
  cardId = card.cardId;
});

afterEach(async () => {
  try {
    try {
      // Track paths at begin time so partially failed uploads are cleaned up too.
      await removeStatements(paths);
    } finally {
      if (userId) await deleteTestUser(userId);
    }
  } finally {
    vi.unstubAllEnvs();
  }
});

function testContext() {
  if (!userId) throw new Error("db-test:process_upload:missing_user");
  return { userId, cardId, admin: createSupabaseAdminClient() };
}

// processUpload deliberately swallows service failures. Preserve only sanitized
// operation/code errors here so a missing migration or bucket remains diagnosable.
async function observe<T>(operation: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const safeError = error instanceof StoreError || error instanceof QueryError
      ? error : new Error(`db-test:${operation}:unexpected_response`);
    diagnostics.push(safeError);
    throw safeError;
  }
}

async function observeRpc<T extends { kind: string }>(
  operation: string, allowedKinds: string[], call: () => Promise<T>,
): Promise<T> {
  return observe(operation, async () => {
    const result = await call();
    if (!allowedKinds.includes(result.kind)) throw new Error(`db-test:${operation}:unexpected_response`);
    return result;
  });
}

function realDeps(): ProcessUploadDeps {
  const { userId, admin } = testContext();
  return {
    today: "2026-10-13",
    beginUpload: (input) => observeRpc("begin_upload", ["started", "duplicate"], async () => {
      const result = await beginUpload(input);
      if (result.kind === "started") paths.push(statementPath(userId, result.uploadId));
      return result;
    }),
    saveStatement: (userId, uploadId, plaintext) => observe("statements.upload", () => saveStatement(userId, uploadId, plaintext)),
    readStatement: async () => parsed,
    findMerchantCategories: (keys) => observe("findMerchantCategories", () => findMerchantCategories(admin, userId, keys)),
    classifier: createMockClassifier(),
    ingestUpload: (input) => observeRpc("ingest_upload", ["done", "no_new"], () => ingestUpload(input)),
    failUpload: (userId, uploadId, code, reason) => observeRpc("fail_upload", ["failed"], () => failUpload(userId, uploadId, code, reason)),
    getUploadOutcome: (uploadId) => observe("getUploadOutcome", () => getUploadOutcome(admin, userId, uploadId)),
  };
}

async function runUpload(deps: ProcessUploadDeps, plaintext = bytes, selectedCardId = cardId) {
  const { userId } = testContext();
  const outcome = await processUpload({ userId, cardId: selectedCardId, fileName: "synthetic.pdf", bytes: plaintext }, deps);
  if (diagnostics.length) throw diagnostics[0];
  return outcome;
}

describe("processUpload against the dev DB and Storage", () => {
  it("stores retained categorized transactions and encrypted bytes, then deduplicates files and rows", async () => {
    const { userId, admin } = testContext();
    const override = await admin.from("merchant_category_overrides").insert({
      user_id: userId, merchant_key: normalizeMerchantKey("스타벅스 사용자 수정"), category: "grocery",
    });
    if (override.error) throw new Error(`db-test:insert_override:${override.error.code}`);
    const deps = realDeps();
    const outcome = await runUpload(deps);
    expect(outcome).toMatchObject({ kind: "done", inserted: 3, duplicates: 0, skipped: 1,
      periodFrom: "2025-10-13", periodTo: "2026-09-03", netAmount: 26734 });
    if (outcome.kind !== "done") throw new Error("db-test:ingest_upload:unexpected_response");

    const saved = await admin.from("transactions")
      .select("used_on, merchant, merchant_key, amount, event_kind, category, fingerprint")
      .eq("user_id", userId).eq("upload_id", outcome.uploadId).order("used_on").range(0, 3);
    if (saved.error) throw new Error(`db-test:read_transactions:${saved.error.code}`);
    const categories = ["cafe", "grocery", "etc"];
    expect(saved.data).toEqual(parsed.transactions.slice(1).map((transaction, index) => ({
      used_on: transaction.date, merchant: transaction.merchant, merchant_key: transaction.merchantKey,
      amount: transaction.amount, event_kind: transaction.eventKind, category: categories[index],
      fingerprint: transactionFingerprint({ cardId, identityScope: parsed.identityScope,
        sourceEventKey: transaction.sourceEventKey, eventKind: transaction.eventKind }),
    })));

    const path = statementPath(userId, outcome.uploadId);
    const { data, error } = await admin.storage.from(STATEMENTS_BUCKET).download(path);
    if (error) throw new StoreError("statements.download", error.statusCode || error.name);
    const payload = new Uint8Array(await data.arrayBuffer());
    expect(Buffer.from(payload)).not.toEqual(Buffer.from(bytes));
    expect(Buffer.from(decryptStatement(payload, key, path))).toEqual(Buffer.from(bytes));

    expect(await runUpload(deps)).toEqual({ kind: "duplicate", existingCardId: cardId });
    const otherCard = await createCard(userId, "다른 카드");
    if (otherCard.kind !== "created") throw new Error("db-test:create_card:unexpected_response");
    expect(await runUpload(deps, bytes, otherCard.cardId)).toEqual({ kind: "duplicate", existingCardId: cardId });
    expect(paths).toHaveLength(1);

    const noNew = await runUpload(deps, new TextEncoder().encode("%PDF-synthetic-different-bytes"));
    expect(noNew).toMatchObject({ kind: "no_new", inserted: 0, duplicates: 3, skipped: 1,
      periodFrom: null, periodTo: null, netAmount: 0 });
    expect(paths).toHaveLength(2);
  });

  it("persists a parsing rejection as failed with its exact code and reason", async () => {
    const deps = realDeps();
    deps.readStatement = async () => ({ ok: false, code: "UNREADABLE", reason: "total_mismatch" });
    const outcome = await runUpload(deps);
    expect(outcome).toMatchObject({ kind: "rejected", code: "UNREADABLE", reason: "total_mismatch" });
    if (outcome.kind !== "rejected") throw new Error("db-test:fail_upload:unexpected_response");
    const { userId, admin } = testContext();
    const failed = await admin.from("uploads").select("status, failure_code, failure_reason")
      .eq("user_id", userId).eq("id", outcome.uploadId).single();
    if (failed.error) throw new Error(`db-test:read_upload:${failed.error.code}`);
    expect(failed.data).toEqual({ status: "failed", failure_code: "UNREADABLE", failure_reason: "total_mismatch" });
  });
});
