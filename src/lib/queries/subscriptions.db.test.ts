import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveSubscription } from "@/lib/store/subscriptions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createTestUser, deleteTestUser } from "@/lib/supabase/db-test-helpers";
import { getSubscription } from "./subscriptions";

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

describe("getSubscription against the dev DB (admin reads; RLS covered by pgTAP)", () => {
  it("returns null before a subscription is saved", async () => {
    expect(await getSubscription(createSupabaseAdminClient(), userId)).toBeNull();
  });

  it("reads Pro and then the newer Free state", async () => {
    const input = { userId, syncedFrom: "2026-10-13T06:00:00Z", plan: "pro" as const,
      subscriptionId: "test-subscription", currentPeriodEnd: "2026-11-12T15:30:00+00:00", cancelAtPeriodEnd: true };
    expect((await saveSubscription(input)).kind).toBe("saved");
    const admin = createSupabaseAdminClient();
    expect(await getSubscription(admin, userId)).toEqual({ plan: "pro", currentPeriodEnd: input.currentPeriodEnd, cancelAtPeriodEnd: true });
    expect((await saveSubscription({ ...input, plan: "free", syncedFrom: "2026-10-13T06:01:00Z" })).kind).toBe("saved");
    expect(await getSubscription(admin, userId)).toEqual({ plan: "free", currentPeriodEnd: null, cancelAtPeriodEnd: false });
  });

  it("explicitly scopes each admin read to the supplied user's state", async () => {
    const otherId = (await createTestUser()).id;
    userIds.push(otherId);
    expect((await saveSubscription({ userId, syncedFrom: "2026-10-13T06:00:00Z", plan: "pro",
      subscriptionId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false })).kind).toBe("saved");
    const admin = createSupabaseAdminClient();
    expect(await getSubscription(admin, otherId)).toBeNull();
    expect((await saveSubscription({ userId: otherId, syncedFrom: "2026-10-13T06:00:00Z", plan: "free",
      subscriptionId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false })).kind).toBe("saved");
    expect(await getSubscription(admin, userId)).toEqual({ plan: "pro", currentPeriodEnd: null, cancelAtPeriodEnd: false });
    expect(await getSubscription(admin, otherId)).toEqual({ plan: "free", currentPeriodEnd: null, cancelAtPeriodEnd: false });
  });
});
