import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findMerchantCategories } from "@/lib/queries/merchant-categories";
import { listTransactions } from "@/lib/queries/transactions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TEST_CARD, createTestUser, deleteTestUser } from "@/lib/supabase/db-test-helpers";
import type { IngestRow } from "@/types/upload";
import { createCard } from "./cards";
import { setMerchantCategory } from "./merchant-categories";
import { beginUpload, ingestUpload } from "./uploads";

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
  expect(await ingestUpload({ userId, uploadId: upload.uploadId, identityScope: "content", cancelStyle: "negative_amount", rows, skipped: 0 }))
    .toMatchObject({ kind: "done", inserted: rows.length });
  return new Map([[card.cardId, "생활비 카드"]]);
}

describe("setMerchantCategory against the dev DB", () => {
  it("updates both A transactions and its override without changing B's same merchant", async () => {
    const row: IngestRow = { usedOn: "2026-09-01", merchant: "예시 가맹점", merchantKey: "예시가맹점",
      amount: 1000, eventKind: "purchase", category: "etc", fingerprint: "1".repeat(64) };
    const labelsA = await saveRows(userA, [row, { ...row, usedOn: "2026-09-02", fingerprint: "2".repeat(64) }]);
    const labelsB = await saveRows(userB, [{ ...row, category: "health" }]);
    expect(await setMerchantCategory(userA, row.merchantKey, "cafe")).toEqual({ kind: "updated", updated: 2 });
    const admin = createSupabaseAdminClient();
    expect(await findMerchantCategories(admin, userA, [row.merchantKey])).toEqual(new Map([[row.merchantKey, "cafe"]]));
    expect((await listTransactions(admin, userA, labelsA)).map((transaction) => transaction.category)).toEqual(["cafe", "cafe"]);
    expect((await listTransactions(admin, userB, labelsB)).map((transaction) => transaction.category)).toEqual(["health"]);
    expect(await findMerchantCategories(admin, userB, [row.merchantKey])).toEqual(new Map([[row.merchantKey, "health"]]));
    expect(await setMerchantCategory(userA, row.merchantKey, "cafe")).toEqual({ kind: "updated", updated: 0 });
  });

  it("returns not_found and creates no override for a merchant without transactions", async () => {
    expect(await setMerchantCategory(userA, "없는가맹점", "food")).toEqual({ kind: "not_found" });
    const { data, error } = await createSupabaseAdminClient().from("merchant_category_overrides")
      .select("category").eq("user_id", userA).eq("merchant_key", "없는가맹점").maybeSingle();
    if (error) throw new Error(`db-test:read_override:${error.code}`);
    expect(data).toBeNull();
  });
});
