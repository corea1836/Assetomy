import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveSummaryFeedback } from "@/lib/store/summary-feedback";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createTestUser, deleteTestUser } from "@/lib/supabase/db-test-helpers";
import { listSummaryFeedback } from "./summary-feedback";

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

describe("summary feedback against the dev DB", () => {
  it("saves, replaces, deletes, and keeps each user's feedback separate", async () => {
    const admin = createSupabaseAdminClient();
    expect(await listSummaryFeedback(admin, userA)).toEqual({});

    expect(await saveSummaryFeedback(userA, "cafe", "평일 오전 커피")).toEqual({ kind: "saved" });
    expect(await listSummaryFeedback(admin, userA)).toEqual({ cafe: "평일 오전 커피" });

    expect(await saveSummaryFeedback(userA, "cafe", "주말 디카페인")).toEqual({ kind: "saved" });
    expect(await listSummaryFeedback(admin, userA)).toEqual({ cafe: "주말 디카페인" });

    expect(await saveSummaryFeedback(userB, "food", "가족 식사")).toEqual({ kind: "saved" });
    expect(await listSummaryFeedback(admin, userA)).toEqual({ cafe: "주말 디카페인" });
    expect(await listSummaryFeedback(admin, userB)).toEqual({ food: "가족 식사" });

    expect(await saveSummaryFeedback(userA, "cafe", "")).toEqual({ kind: "deleted" });
    expect(await listSummaryFeedback(admin, userA)).toEqual({});
    expect(await listSummaryFeedback(admin, userB)).toEqual({ food: "가족 식사" });
  });

  it("rejects a body longer than the database's 100 code point constraint", async () => {
    await expect(saveSummaryFeedback(userA, "food", "가".repeat(101)))
      .rejects.toMatchObject({ operation: "save_summary_feedback", code: "23514" });
  });
});
