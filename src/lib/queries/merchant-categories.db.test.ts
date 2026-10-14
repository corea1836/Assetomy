import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCard } from "@/lib/store/cards";
import { beginUpload, ingestUpload } from "@/lib/store/uploads";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TEST_CARD, createTestUser, deleteTestUser } from "@/lib/supabase/db-test-helpers";
import type { IngestRow } from "@/types/upload";
import { findMerchantCategories } from "./merchant-categories";

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

async function saveRows(userId: string, cardId: string, hash: string, rows: IngestRow[]) {
  const upload = await beginUpload({ userId, cardId, fileName: "test.csv", fileHash: hash.repeat(64), fileSize: 100 });
  if (upload.kind !== "started") throw new Error("db-test:begin_upload:unexpected_response");
  const result = await ingestUpload({ userId, uploadId: upload.uploadId, identityScope: "content",
    cancelStyle: "negative_amount", rows, skipped: 0 });
  expect(result.kind).toBe("done");
}

function row(index: number, merchantKey: string, category: IngestRow["category"]): IngestRow {
  return { usedOn: "2026-09-01", merchant: merchantKey, merchantKey, category, amount: 1000,
    eventKind: "purchase", fingerprint: index.toString(16).padStart(64, "0") };
}

describe("findMerchantCategories against the dev DB", () => {
  it("prioritizes A's override and latest transactions across chunks without including B's same keys", async () => {
    const cardA = await createCard(userA, { label: "생활비 카드", ...TEST_CARD });
    const cardB = await createCard(userB, { label: "생활비 카드", ...TEST_CARD });
    if (cardA.kind !== "created" || cardB.kind !== "created") throw new Error("db-test:create_card:unexpected_response");
    await saveRows(userA, cardA.cardId, "a", [row(1000, "X", "etc")]);
    const extraKeys = Array.from({ length: 149 }, (_, index) => `키${index}`);
    await saveRows(userA, cardA.cardId, "b", [row(0, "X", "food"), row(1, "Y", "cafe"),
      ...extraKeys.map((key, index) => row(index + 2, key, "etc"))]);
    await saveRows(userB, cardB.cardId, "c", [row(0, "X", "health"), row(1, "Y", "finance")]);
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("merchant_category_overrides").insert([
      { user_id: userA, merchant_key: "Y", category: "shopping" },
      { user_id: userB, merchant_key: "X", category: "transport" },
      { user_id: userB, merchant_key: "Y", category: "finance" },
      { user_id: userB, merchant_key: "unknown", category: "food" },
    ]);
    if (error) throw new Error(`db-test:insert_overrides:${error.code}`);
    const categories = await findMerchantCategories(admin, userA, ["X", "Y", ...extraKeys, "unknown"]);
    expect(categories.size).toBe(151);
    expect(categories.get("X")).toBe("food");
    expect(categories.get("Y")).toBe("shopping");
    expect(categories.has("unknown")).toBe(false);
    for (const key of extraKeys) expect(categories.get(key)).toBe("etc");
  });
});
