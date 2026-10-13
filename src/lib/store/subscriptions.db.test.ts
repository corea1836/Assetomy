import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSubscription } from "@/lib/queries/subscriptions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createTestUser, deleteTestUser } from "@/lib/supabase/db-test-helpers";
import type { SaveSubscriptionInput, StoredSubscription } from "@/types/billing";
import { saveSubscription } from "./subscriptions";

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

function proInput(): SaveSubscriptionInput {
  return { userId, syncedFrom: "2026-10-13T06:00:00Z", plan: "pro", subscriptionId: "test-subscription",
    currentPeriodEnd: "2026-11-12T15:30:00+00:00", cancelAtPeriodEnd: true };
}

describe("saveSubscription against the dev DB", () => {
  it("saves the first Pro state and reads the same values through the admin client", async () => {
    const input = proInput();
    const subscription = { plan: "pro", currentPeriodEnd: input.currentPeriodEnd, cancelAtPeriodEnd: true };
    expect(await saveSubscription(input)).toEqual({ kind: "saved", subscription });
    expect(await getSubscription(createSupabaseAdminClient(), userId)).toEqual(subscription);
  });

  it("accepts newer Free, clears Pro fields, and returns Free for older or equal Pro requests", async () => {
    const input = proInput();
    expect((await saveSubscription(input)).kind).toBe("saved");
    const free = { plan: "free", currentPeriodEnd: null, cancelAtPeriodEnd: false };
    const syncedFrom = "2026-10-13T06:01:00Z";
    expect(await saveSubscription({ ...input, plan: "free", syncedFrom })).toEqual({ kind: "saved", subscription: free });
    for (const start of [input.syncedFrom, syncedFrom]) {
      expect(await saveSubscription({ ...input, syncedFrom: start })).toEqual({ kind: "stale", subscription: free });
    }
    expect(await getSubscription(createSupabaseAdminClient(), userId)).toEqual(free);
  });

  it("returns user_not_found for a nonexistent UUID", async () => {
    expect(await saveSubscription({ ...proInput(), userId: randomUUID() })).toEqual({ kind: "user_not_found" });
  });

  it("cascades user deletion and refuses to recreate a deleted user's subscription", async () => {
    const input = proInput();
    expect((await saveSubscription(input)).kind).toBe("saved");
    await deleteTestUser(userId);
    userIds = userIds.filter((id) => id !== userId);
    expect(await getSubscription(createSupabaseAdminClient(), userId)).toBeNull();
    expect(await saveSubscription(input)).toEqual({ kind: "user_not_found" });
  });

  it("persists mock Pro with null subscription id and period", async () => {
    const subscription: StoredSubscription = { plan: "pro", currentPeriodEnd: null, cancelAtPeriodEnd: false };
    expect(await saveSubscription({ ...proInput(), subscriptionId: null, ...subscription }))
      .toEqual({ kind: "saved", subscription });
    expect(await getSubscription(createSupabaseAdminClient(), userId)).toEqual(subscription);
  });
});
