import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createTestUser, deleteTestUser } from "@/lib/supabase/db-test-helpers";
import type { IngestRow } from "@/types/upload";
import { createCard } from "./cards";
import { beginUpload, deleteUpload, failUpload, ingestUpload } from "./uploads";

let userIds: string[] = [];
let userA: string;
let userB: string;
let cardId: string;

beforeEach(async () => {
  userA = (await createTestUser()).id;
  userIds.push(userA);
  userB = (await createTestUser()).id;
  userIds.push(userB);
  const card = await createCard(userA, "생활비 카드");
  if (card.kind !== "created") throw new Error("db-test:create_card:unexpected_response");
  cardId = card.cardId;
});

afterEach(async () => {
  // 정리에 하나가 실패해도 나머지 임시 사용자의 삭제는 모두 시도한다.
  const results = await Promise.allSettled(userIds.map(deleteTestUser));
  userIds = [];
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }
});

function begin(hash: string, userId = userA, selectedCardId = cardId) {
  return beginUpload({ userId, cardId: selectedCardId, fileName: "test.pdf", fileHash: hash.repeat(64), fileSize: 100 });
}

async function start(hash: string): Promise<string> {
  const result = await begin(hash);
  if (result.kind !== "started") throw new Error("db-test:begin_upload:unexpected_response");
  expect(result.leaseExpiresAt).toEqual(expect.any(String));
  return result.uploadId;
}

async function expire(uploadId: string) {
  const { error } = await createSupabaseAdminClient().from("uploads")
    .update({ lease_expires_at: "2000-01-01T00:00:00Z" })
    .eq("user_id", userA).eq("id", uploadId);
  if (error) throw new Error(`db-test:expire_upload:${error.code}`);
}

const rows: IngestRow[] = [
  { usedOn: "2026-09-01", merchant: "예시 가맹점 A", merchantKey: "예시가맹점a", amount: 10000, eventKind: "purchase", category: "food", fingerprint: "1".repeat(64) },
  { usedOn: "2026-09-03", merchant: "예시 가맹점 B", merchantKey: "예시가맹점b", amount: 20000, eventKind: "purchase", category: "cafe", fingerprint: "2".repeat(64) },
  { usedOn: "2026-09-05", merchant: "예시 가맹점 A", merchantKey: "예시가맹점a", amount: -5000, eventKind: "cancel", category: "food", fingerprint: "3".repeat(64) },
];

function ingest(uploadId: string) {
  return ingestUpload({ userId: userA, uploadId, identityScope: "content", cancelStyle: "negative_amount", rows, skipped: 2 });
}

describe("upload RPCs against the dev DB", () => {
  it("checks card ownership and counts only unexpired processing leases", async () => {
    expect(await begin("a", userB)).toEqual({ kind: "card_not_found" });
    const first = await start("a");
    await start("b");
    expect(await begin("c")).toEqual({ kind: "busy" });
    await expire(first);
    expect((await begin("c")).kind).toBe("started");
  });

  it("limits users with 30 upload attempts in the past 24 hours", async () => {
    const { error } = await createSupabaseAdminClient().from("upload_attempts")
      .insert(Array.from({ length: 30 }, () => ({ user_id: userA })));
    if (error) throw new Error(`db-test:insert_attempts:${error.code}`);
    expect(await begin("a")).toEqual({ kind: "rate_limited" });
  });

  it("atomically ingests rows, fixes the card scope, deduplicates, and rejects expired leases", async () => {
    const first = await start("a");
    expect(await ingest(first)).toEqual({
      kind: "done", inserted: 3, duplicates: 0, skipped: 2,
      periodFrom: "2026-09-01", periodTo: "2026-09-05", netAmount: 25000,
    });

    const admin = createSupabaseAdminClient();
    const transactions = await admin.from("transactions")
      .select("used_on, merchant, merchant_key, amount, event_kind, category, fingerprint")
      .eq("user_id", userA).eq("upload_id", first).order("used_on").range(0, 3);
    if (transactions.error) throw new Error(`db-test:read_transactions:${transactions.error.code}`);
    expect(transactions.data).toEqual(rows.map((row) => ({
      used_on: row.usedOn, merchant: row.merchant, merchant_key: row.merchantKey,
      amount: row.amount, event_kind: row.eventKind, category: row.category, fingerprint: row.fingerprint,
    })));

    const card = await admin.from("cards").select("identity_scope, cancel_style")
      .eq("user_id", userA).eq("id", cardId).single();
    if (card.error) throw new Error(`db-test:read_card:${card.error.code}`);
    expect(card.data).toEqual({ identity_scope: "content", cancel_style: "negative_amount" });

    const second = await start("b");
    expect(await ingest(second)).toEqual({
      kind: "no_new", inserted: 0, duplicates: 3, skipped: 2,
      periodFrom: null, periodTo: null, netAmount: 0,
    });
    expect(await begin("a")).toEqual({ kind: "duplicate", existingCardId: cardId });
    const otherCard = await createCard(userA, "다른 카드");
    if (otherCard.kind !== "created") throw new Error("db-test:create_card:unexpected_response");
    expect(await begin("a", userA, otherCard.cardId)).toEqual({ kind: "duplicate", existingCardId: cardId });

    const expired = await start("c");
    await expire(expired);
    expect(await ingest(expired)).toEqual({ kind: "lease_expired" });
  });

  it("stores the failure code and reason for a processing upload", async () => {
    const uploadId = await start("a");
    expect(await failUpload(userA, uploadId, "UNREADABLE", "total_mismatch")).toEqual({ kind: "failed" });
    const result = await createSupabaseAdminClient().from("uploads")
      .select("status, failure_code, failure_reason, lease_expires_at")
      .eq("user_id", userA).eq("id", uploadId).single();
    if (result.error) throw new Error(`db-test:read_upload:${result.error.code}`);
    expect(result.data).toEqual({ status: "failed", failure_code: "UNREADABLE", failure_reason: "total_mismatch", lease_expires_at: null });
  });

  it("hides another user's upload and cascades deletion to its transactions", async () => {
    const uploadId = await start("a");
    await ingest(uploadId);
    expect(await deleteUpload(userB, uploadId)).toEqual({ kind: "not_found" });
    expect(await deleteUpload(userA, uploadId)).toEqual({ kind: "deleted" });
    const result = await createSupabaseAdminClient().from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userA).eq("upload_id", uploadId);
    if (result.error) throw new Error(`db-test:count_transactions:${result.error.code}`);
    expect(result.count).toBe(0);
  });
});
