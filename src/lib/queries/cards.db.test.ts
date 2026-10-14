import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCard } from "@/lib/store/cards";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TEST_CARD, createTestUser, deleteTestUser } from "@/lib/supabase/db-test-helpers";
import { listCards } from "./cards";

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

describe("listCards against the dev DB", () => {
  it("returns only A's cards in creation order when using the admin client", async () => {
    const first = await createCard(userA, { label: "생활비 카드", ...TEST_CARD });
    const other = await createCard(userB, { label: "다른 사용자 카드", ...TEST_CARD });
    const second = await createCard(userA, { label: "온라인 쇼핑 카드", issuer: "shinhan", analysisBasis: "cycle", cycleStartDay: 12 });
    if (first.kind !== "created" || second.kind !== "created" || other.kind !== "created") {
      throw new Error("db-test:create_card:unexpected_response");
    }
    expect(await listCards(createSupabaseAdminClient(), userA)).toEqual([
      {
        id: first.cardId, label: "생활비 카드", issuer: "hyundai", analysisBasis: "month", cycleStartDay: null,
      },
      {
        id: second.cardId, label: "온라인 쇼핑 카드", issuer: "shinhan", analysisBasis: "cycle", cycleStartDay: 12,
      },
    ]);
  });
});
