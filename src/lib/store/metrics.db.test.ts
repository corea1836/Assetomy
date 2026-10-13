import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createTestUser, deleteTestUser } from "@/lib/supabase/db-test-helpers";
import { createCard } from "./cards";
import { recordMetric } from "./metrics";
import { beginUpload, deleteUpload, ingestUpload } from "./uploads";

let userIds: string[] = [];
let userId: string;

beforeEach(async () => {
  userId = (await createTestUser()).id;
  userIds.push(userId);
});
afterEach(async () => {
  const results = await Promise.allSettled(userIds.map(deleteTestUser));
  userIds = [];
  for (const result of results) if (result.status === "rejected") throw result.reason;
});

async function readMetrics() {
  const { data, error } = await createSupabaseAdminClient().from("user_metrics")
    .select("first_attempt_at, first_success_at, teaser_seen_at, first_click_at, upgrade_source, first_paid_at")
    .eq("user_id", userId).single();
  if (error) throw new Error(`db-test:read_metrics:${error.code}`);
  return data;
}

describe("dashboard metrics against the dev DB", () => {
  it("records Free teaser, first click source, and first_paid only once", async () => {
    expect(await recordMetric(userId, { event: "teaser_seen" })).toEqual({ kind: "recorded" });
    const teaser = await readMetrics();
    expect(teaser.teaser_seen_at).toEqual(expect.any(String));
    expect(await recordMetric(userId, { event: "teaser_seen" })).toEqual({ kind: "unchanged" });
    expect((await readMetrics()).teaser_seen_at).toBe(teaser.teaser_seen_at);

    expect(await recordMetric(userId, { event: "upgrade_click", source: "summary" })).toEqual({ kind: "recorded" });
    const click = await readMetrics();
    expect(click.first_click_at).toEqual(expect.any(String));
    expect(click.upgrade_source).toBe("summary");
    expect(await recordMetric(userId, { event: "upgrade_click", source: "teaser" })).toEqual({ kind: "unchanged" });
    expect((await readMetrics()).first_click_at).toBe(click.first_click_at);

    expect(await recordMetric(userId, { event: "first_paid" })).toEqual({ kind: "recorded" });
    const paid = await readMetrics();
    expect(paid.first_paid_at).toEqual(expect.any(String));
    expect(paid.upgrade_source).toBe("summary");
    expect(paid.first_click_at).toBe(click.first_click_at);
    expect(await recordMetric(userId, { event: "first_paid" })).toEqual({ kind: "unchanged" });
    expect(await readMetrics()).toEqual(paid);
  });

  it("returns user_not_found for an absent UUID", async () => {
    expect(await recordMetric(randomUUID(), { event: "first_paid" })).toEqual({ kind: "user_not_found" });
  });

  it("records upload attempt, success, period extension, and deletion in the upload transactions", async () => {
    const card = await createCard(userId, "생활비 카드");
    if (card.kind !== "created") throw new Error("db-test:create_card:unexpected_response");
    const upload = await beginUpload({ userId, cardId: card.cardId, fileName: "test.csv", fileHash: "a".repeat(64), fileSize: 100 });
    if (upload.kind !== "started") throw new Error("db-test:begin_upload:unexpected_response");
    const initial = await readMetrics();
    expect(initial.first_attempt_at).toEqual(expect.any(String));
    expect(initial.first_success_at).toBeNull();
    expect(await ingestUpload({ userId, uploadId: upload.uploadId, identityScope: "content", cancelStyle: "negative_amount",
      rows: [{ usedOn: "2026-09-01", merchant: "예시 가맹점", merchantKey: "예시가맹점", amount: 1000,
        eventKind: "purchase", category: "food", fingerprint: "1".repeat(64) }], skipped: 0 }))
      .toMatchObject({ kind: "done", inserted: 1 });
    const success = await readMetrics();
    expect(success.first_attempt_at).toBe(initial.first_attempt_at);
    expect(success.first_success_at).toEqual(expect.any(String));

    const admin = createSupabaseAdminClient();
    const attempt = await admin.from("upload_attempts").select("created_at, completed_at, extends_period, deleted_at")
      .eq("user_id", userId).eq("upload_id", upload.uploadId).single();
    if (attempt.error) throw new Error(`db-test:read_attempt:${attempt.error.code}`);
    expect(attempt.data).toEqual({
      created_at: success.first_attempt_at, completed_at: success.first_success_at, extends_period: true, deleted_at: null,
    });

    expect(await deleteUpload(userId, upload.uploadId)).toEqual({ kind: "deleted" });
    const deleted = await admin.from("upload_attempts").select("deleted_at, extends_period")
      .eq("user_id", userId).eq("upload_id", upload.uploadId).single();
    if (deleted.error) throw new Error(`db-test:read_attempt:${deleted.error.code}`);
    expect(deleted.data).toEqual({ deleted_at: expect.any(String), extends_period: true });
    expect(await readMetrics()).toEqual(success);
  });
});
