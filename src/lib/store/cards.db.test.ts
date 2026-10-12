import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, deleteTestUser } from "@/lib/supabase/db-test-helpers";
import { createCard } from "./cards";

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
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }
});

describe("createCard against the dev DB", () => {
  it("creates a card, rejects duplicate and invalid labels, and isolates users", async () => {
    const created = await createCard(userA, "생활비 카드");
    expect(created.kind).toBe("created");
    if (created.kind !== "created") throw new Error("db-test:create_card:unexpected_response");
    expect(created.cardId).toEqual(expect.any(String));
    expect(await createCard(userA, "생활비 카드")).toEqual({ kind: "duplicate_label" });
    expect(await createCard(userA, " ")).toEqual({ kind: "invalid_label" });
    expect((await createCard(userB, "생활비 카드")).kind).toBe("created");
  });
});
