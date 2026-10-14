import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCard } from "@/lib/store/cards";
import { beginUpload, failUpload, ingestUpload } from "@/lib/store/uploads";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TEST_CARD, createTestUser, deleteTestUser } from "@/lib/supabase/db-test-helpers";
import type { IngestRow } from "@/types/upload";
import { getUploadOutcome, listDoneUploads } from "./uploads";

let userIds: string[] = [];
let userA: string;
let userB: string;
let cardId: string;

beforeEach(async () => {
  userA = (await createTestUser()).id;
  userIds.push(userA);
  userB = (await createTestUser()).id;
  userIds.push(userB);
  const card = await createCard(userA, { label: "생활비 카드", ...TEST_CARD });
  if (card.kind !== "created") throw new Error("db-test:create_card:unexpected_response");
  cardId = card.cardId;
});

afterEach(async () => {
  const results = await Promise.allSettled(userIds.map(deleteTestUser));
  userIds = [];
  for (const result of results) if (result.status === "rejected") throw result.reason;
});

async function start(hash: string) {
  const result = await beginUpload({ userId: userA, cardId, fileName: "test.csv", fileHash: hash.repeat(64), fileSize: 100 });
  if (result.kind !== "started") throw new Error("db-test:begin_upload:unexpected_response");
  return result.uploadId;
}

const rows: IngestRow[] = [
  { usedOn: "2026-09-01", merchant: "예시 A", merchantKey: "예시a", amount: 10000,
    eventKind: "purchase", category: "food", fingerprint: "1".repeat(64) },
  { usedOn: "2026-09-03", merchant: "예시 A", merchantKey: "예시a", amount: -500,
    eventKind: "cancel", category: "food", fingerprint: "2".repeat(64) },
];

function ingest(uploadId: string) {
  return ingestUpload({ userId: userA, uploadId, identityScope: "content", cancelStyle: "negative_amount", rows, skipped: 2 });
}

describe("getUploadOutcome against the dev DB", () => {
  it("reads the persisted done summary, processing status, and hides another user's upload", async () => {
    const uploadId = await start("a");
    const admin = createSupabaseAdminClient();
    expect(await getUploadOutcome(admin, userA, uploadId)).toEqual({ status: "processing" });
    expect(await ingest(uploadId)).toMatchObject({ kind: "done" });
    expect(await getUploadOutcome(admin, userA, uploadId)).toEqual({ status: "done", inserted: 2,
      duplicates: 0, skipped: 2, periodFrom: "2026-09-01", periodTo: "2026-09-03", netAmount: 9500 });
    expect(await getUploadOutcome(admin, userB, uploadId)).toBeNull();
    const pending = await start("b");
    expect(await getUploadOutcome(admin, userA, pending)).toEqual({ status: "processing" });
  });

  it("reads no_new and failed outcomes", async () => {
    await ingest(await start("a"));
    const duplicate = await start("b");
    expect(await ingest(duplicate)).toMatchObject({ kind: "no_new" });
    const admin = createSupabaseAdminClient();
    expect(await getUploadOutcome(admin, userA, duplicate)).toEqual({ status: "no_new", inserted: 0,
      duplicates: 2, skipped: 2, periodFrom: null, periodTo: null, netAmount: 0 });
    const failed = await start("c");
    expect(await failUpload(userA, failed, "UNREADABLE")).toEqual({ kind: "failed" });
    expect(await getUploadOutcome(admin, userA, failed)).toEqual({ status: "failed" });
  });
});

describe("listDoneUploads against the dev DB", () => {
  it("lists only the user's done uploads, newest first", async () => {
    const first = await start("a");
    await ingest(first);
    const duplicate = await start("b");
    expect(await ingest(duplicate)).toMatchObject({ kind: "no_new" });
    expect(await failUpload(userA, await start("c"), "UNREADABLE")).toEqual({ kind: "failed" });
    await start("d");
    const otherCard = await createCard(userB, { label: "다른 사용자 카드", ...TEST_CARD });
    if (otherCard.kind !== "created") throw new Error("db-test:create_card:unexpected_response");
    const other = await beginUpload({ userId: userB, cardId: otherCard.cardId, fileName: "b.pdf", fileHash: "e".repeat(64), fileSize: 100 });
    if (other.kind !== "started") throw new Error("db-test:begin_upload:unexpected_response");
    await ingestUpload({ userId: userB, uploadId: other.uploadId, identityScope: "content", cancelStyle: "negative_amount", rows, skipped: 0 });
    const second = await start("f");
    await ingestUpload({ userId: userA, uploadId: second, identityScope: "content", cancelStyle: "negative_amount",
      rows: [{ ...rows[0], usedOn: "2026-10-01", fingerprint: "3".repeat(64) }], skipped: 0 });

    const admin = createSupabaseAdminClient();
    expect(await listDoneUploads(admin, userA)).toEqual([
      { id: second, cardId, fileName: "test.csv", inserted: 1, periodFrom: "2026-10-01", periodTo: "2026-10-01" },
      { id: first, cardId, fileName: "test.csv", inserted: 2, periodFrom: "2026-09-01", periodTo: "2026-09-03" },
    ]);
    expect((await listDoneUploads(admin, userB)).map(({ id }) => id)).toEqual([other.uploadId]);
  });
});
