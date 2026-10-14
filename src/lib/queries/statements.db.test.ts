import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCard } from "@/lib/store/cards";
import { beginUpload, ingestUpload } from "@/lib/store/uploads";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TEST_CARD, createTestUser, deleteTestUser } from "@/lib/supabase/db-test-helpers";
import type { IngestRow } from "@/types/upload";
import { listStatements } from "./statements";

let userIds: string[] = [];
let userA: string;
let userB: string;
let cardA: string;
let cardB: string;

beforeEach(async () => {
  userA = (await createTestUser()).id;
  userIds.push(userA);
  userB = (await createTestUser()).id;
  userIds.push(userB);
  const cardAResult = await createCard(userA, { label: "생활비 카드", ...TEST_CARD });
  const cardBResult = await createCard(userB, { label: "다른 사용자 카드", ...TEST_CARD });
  if (cardAResult.kind !== "created" || cardBResult.kind !== "created") {
    throw new Error("db-test:create_card:unexpected_response");
  }
  cardA = cardAResult.cardId;
  cardB = cardBResult.cardId;
});

afterEach(async () => {
  const results = await Promise.allSettled(userIds.map(deleteTestUser));
  userIds = [];
  for (const result of results) if (result.status === "rejected") throw result.reason;
});

const row: IngestRow = {
  usedOn: "2026-10-01", merchant: "예시 가맹점", merchantKey: "예시가맹점", amount: 1000,
  eventKind: "purchase", category: "food", fingerprint: "a".repeat(64),
};

async function upload(userId: string, cardId: string, hash: string, statementDate: string | null, saveTime: string | null) {
  const started = await beginUpload({ userId, cardId, fileName: "test.pdf", fileHash: hash.repeat(64), fileSize: 100 });
  if (started.kind !== "started") throw new Error("db-test:begin_upload:unexpected_response");
  if (statementDate === null) {
    const result = await ingestUpload({ userId, uploadId: started.uploadId, identityScope: "content",
      cancelStyle: "negative_amount", rows: [{ ...row, fingerprint: hash.repeat(64) }], skipped: 0,
      issuer: null, productName: null, statementDate: null, statementSavedAt: null });
    if (result.kind !== "done") throw new Error("db-test:ingest_upload:unexpected_response");
  } else {
    const result = await ingestUpload({ userId, uploadId: started.uploadId, identityScope: "content",
      cancelStyle: "negative_amount", rows: [{ ...row, fingerprint: hash.repeat(64) }], skipped: 0,
      issuer: "hyundai", productName: "현대카드MM", statementDate, statementSavedAt: saveTime });
    if (result.kind !== "done") throw new Error("db-test:ingest_upload:unexpected_response");
  }
  return started.uploadId;
}

describe("listStatements against the dev DB", () => {
  it("returns only this user's done uploads with statement dates", async () => {
    await upload(userA, cardA, "1", "2026-10-23", "2020-01-01T00:00:00+00:00");
    await upload(userA, cardA, "2", null, null);

    const pending = await beginUpload({ userId: userA, cardId: cardA, fileName: "pending.pdf", fileHash: "3".repeat(64), fileSize: 100 });
    expect(pending.kind).toBe("started");
    await upload(userB, cardB, "4", "2026-10-23", "2020-01-01T00:00:00+00:00");

    expect(await listStatements(createSupabaseAdminClient(), userA)).toEqual([
      { cardId: cardA, statementDate: "2026-10-23", savedOn: "2020-01-01" },
    ]);
  });
});
