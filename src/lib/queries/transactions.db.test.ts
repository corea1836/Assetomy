import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCard } from "@/lib/store/cards";
import { beginUpload, ingestUpload } from "@/lib/store/uploads";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TEST_CARD, createTestUser, deleteTestUser } from "@/lib/supabase/db-test-helpers";
import type { IngestRow } from "@/types/upload";
import { listTransactions } from "./transactions";

let userIds: string[] = [];
let userA: string;
let userB: string;

beforeEach(async () => {
  userA = (await createTestUser()).id;
  userIds.push(userA);
  userB = (await createTestUser()).id;
  userIds.push(userB);
});

afterEach(async () => {
  const results = await Promise.allSettled(userIds.map(deleteTestUser));
  userIds = [];
  for (const result of results) if (result.status === "rejected") throw result.reason;
});

async function saveRows(userId: string, rows: IngestRow[]) {
  const card = await createCard(userId, { label: "생활비 카드", ...TEST_CARD });
  if (card.kind !== "created") throw new Error("db-test:create_card:unexpected_response");
  const upload = await beginUpload({ userId, cardId: card.cardId, fileName: "test.csv", fileHash: "a".repeat(64), fileSize: 100 });
  if (upload.kind !== "started") throw new Error("db-test:begin_upload:unexpected_response");
  const result = await ingestUpload({ userId, uploadId: upload.uploadId, identityScope: "content",
    cancelStyle: "negative_amount", rows, skipped: 0 });
  expect(result).toMatchObject({ kind: "done", inserted: rows.length });
  return card.cardId;
}

describe("listTransactions against the dev DB", () => {
  it("reads all 1001 A rows with card labels and ascending dates while excluding B", async () => {
    const admin = createSupabaseAdminClient();
    expect(await listTransactions(admin, userA, new Map())).toEqual([]);
    // 28일씩 잡아 날짜 파싱 없이 서로 다른 유효한 거래일 1001개를 만든다.
    const rows: IngestRow[] = Array.from({ length: 1001 }, (_, index) => ({
      usedOn: `${2023 + Math.floor(index / 336)}-${String(Math.floor((index % 336) / 28) + 1).padStart(2, "0")}-${String(index % 28 + 1).padStart(2, "0")}`,
      merchant: "예시 가맹점", merchantKey: "예시가맹점", amount: 1000, eventKind: "purchase", category: "food",
      fingerprint: index.toString(16).padStart(64, "0"),
    }));
    const cardA = await saveRows(userA, [...rows].reverse());
    await saveRows(userB, [{ ...rows[0], usedOn: "2022-01-01" }, { ...rows[1], usedOn: "2026-10-13" }]);
    const transactions = await listTransactions(admin, userA, new Map([[cardA, "생활비 카드"]]));
    expect(transactions).toHaveLength(1001);
    expect(new Set(transactions.map((transaction) => transaction.id)).size).toBe(1001);
    expect(transactions.map((transaction) => transaction.date)).toEqual(rows.map((row) => row.usedOn));
    for (const transaction of transactions) {
      expect(transaction).toMatchObject({ cardId: cardA, cardLabel: "생활비 카드", amount: 1000, category: "food" });
    }
  });
});
