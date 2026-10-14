import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TEST_CARD, createTestUser, deleteTestUser } from "@/lib/supabase/db-test-helpers";
import type { SaveCardSummaryInput, SaveSummaryInput } from "@/types/summary";
import type { IngestRow } from "@/types/upload";
import { createCard } from "./cards";
import { deleteUpload, beginUpload, ingestUpload } from "./uploads";
import { getStoredCardSummary, getStoredSummary } from "@/lib/queries/summaries";
import { saveCardSummary, saveSummary } from "./summaries";
import { updateCard } from "./cards";

let userIds: string[] = [];
let userA: string;
let userB: string;
let cardA: string;

beforeEach(async () => {
  userA = (await createTestUser()).id;
  userIds.push(userA);
  userB = (await createTestUser()).id;
  userIds.push(userB);
  const card = await createCard(userA, { label: "생활비 카드", ...TEST_CARD });
  if (card.kind !== "created") throw new Error("db-test:create_card:unexpected_response");
  cardA = card.cardId;
});

afterEach(async () => {
  const results = await Promise.allSettled(userIds.map(deleteTestUser));
  userIds = [];
  for (const result of results) if (result.status === "rejected") throw result.reason;
});

async function upload(
  hash: string, rows: IngestRow[], userId = userA, cardId = cardA,
  statementDate: string | null = null, statementSavedAt: string | null = null,
): Promise<string> {
  const started = await beginUpload({
    userId, cardId, fileName: "test.csv", fileHash: hash.repeat(64), fileSize: 100,
  });
  if (started.kind !== "started") throw new Error("db-test:begin_upload:unexpected_response");
  const ingested = await ingestUpload({
    userId, uploadId: started.uploadId, identityScope: "content", cancelStyle: "negative_amount", rows, skipped: 0,
    issuer: statementDate === null ? null : "hyundai",
    productName: statementDate === null ? null : "현대카드MM",
    statementDate, statementSavedAt,
  });
  if (ingested.kind !== "done") throw new Error("db-test:ingest_upload:unexpected_response");
  return started.uploadId;
}

function row(month: string, suffix: string): IngestRow {
  return {
    usedOn: `${month}-15`, merchant: "예시 가맹점", merchantKey: "예시가맹점", amount: 12_000,
    eventKind: "purchase", category: "food", fingerprint: suffix.repeat(64),
  };
}

function summary(month: string, inputHash: string, text: string): SaveSummaryInput {
  return {
    userId: userA, month, plan: "free", model: "claude-sonnet-5-5", inputHash: inputHash.repeat(64), summary: text, tips: [`${text} 팁`],
  };
}

function cardSummary(period: string, inputHash: string, text: string): SaveCardSummaryInput {
  return {
    userId: userA, cardId: cardA, period, plan: "free", model: "claude-sonnet-5-5",
    inputHash: inputHash.repeat(64), summary: text, tips: [`${text} 팁`],
  };
}

describe("summary persistence against the dev DB", () => {
  it("returns no_transactions for an empty month, reads null, then saves and replaces a month summary", async () => {
    const admin = createSupabaseAdminClient();
    expect(await saveSummary(summary("2026-09", "a", "첫 요약"))).toEqual({ kind: "no_transactions" });
    expect(await getStoredSummary(admin, userA, "2026-09")).toBeNull();

    await upload("1", [row("2026-09", "1")]);
    expect(await saveSummary(summary("2026-09", "a", "첫 요약"))).toEqual({ kind: "saved" });
    expect(await getStoredSummary(admin, userA, "2026-09")).toEqual({ inputHash: "a".repeat(64), summary: "첫 요약", tips: ["첫 요약 팁"] });

    expect(await saveSummary(summary("2026-09", "b", "바뀐 요약"))).toEqual({ kind: "saved" });
    expect(await getStoredSummary(admin, userA, "2026-09")).toEqual({ inputHash: "b".repeat(64), summary: "바뀐 요약", tips: ["바뀐 요약 팁"] });
    expect(await getStoredSummary(admin, userB, "2026-09")).toBeNull();
  });

  it("deletes only summaries for months touched by the deleted upload", async () => {
    const admin = createSupabaseAdminClient();
    const upload1 = await upload("2", [row("2026-08", "2"), row("2026-09", "3")]);
    await upload("3", [row("2026-10", "4")]);
    for (const [month, hash] of [["2026-08", "c"], ["2026-09", "d"], ["2026-10", "e"]] as const) {
      expect(await saveSummary(summary(month, hash, `요약 ${month}`))).toEqual({ kind: "saved" });
    }

    expect(await deleteUpload(userA, upload1)).toEqual({ kind: "deleted" });
    expect(await getStoredSummary(admin, userA, "2026-08")).toBeNull();
    expect(await getStoredSummary(admin, userA, "2026-09")).toBeNull();
    expect(await getStoredSummary(admin, userA, "2026-10")).toEqual({ inputHash: "e".repeat(64), summary: "요약 2026-10", tips: ["요약 2026-10 팁"] });
  });
});

describe("card summary persistence against the dev DB", () => {
  it("saves and reads a summary, clears it when basis changes or its upload is deleted", async () => {
    const admin = createSupabaseAdminClient();
    expect(await saveCardSummary(cardSummary("2026-10", "a", "월 요약"))).toEqual({ kind: "no_data" });
    expect(await getStoredCardSummary(admin, userA, cardA, "2026-10")).toBeNull();

    const monthUpload = await upload("6", [row("2026-10", "6")]);
    expect(await saveCardSummary(cardSummary("2026-10", "b", "월 요약"))).toEqual({ kind: "saved" });
    expect(await getStoredCardSummary(admin, userA, cardA, "2026-10")).toEqual({
      inputHash: "b".repeat(64), summary: "월 요약", tips: ["월 요약 팁"],
    });

    expect(await updateCard(userA, cardA, { label: "생활비 카드", analysisBasis: "cycle", cycleStartDay: 12 }))
      .toEqual({ kind: "updated" });
    expect(await getStoredCardSummary(admin, userA, cardA, "2026-10")).toBeNull();
    expect(await saveCardSummary(cardSummary("2026-10", "c", "잘못된 기준"))).toEqual({ kind: "basis_mismatch" });
    expect(await deleteUpload(userA, monthUpload)).toEqual({ kind: "deleted" });

    const statementUpload = await upload("7", [row("2026-10", "7")], userA, cardA,
      "2026-10-23", "2020-01-01T00:00:00+00:00");
    expect(await saveCardSummary(cardSummary("2026-10-23", "d", "명세서 요약"))).toEqual({ kind: "saved" });
    expect(await getStoredCardSummary(admin, userA, cardA, "2026-10-23")).toEqual({
      inputHash: "d".repeat(64), summary: "명세서 요약", tips: ["명세서 요약 팁"],
    });
    expect(await deleteUpload(userA, statementUpload)).toEqual({ kind: "deleted" });
    expect(await getStoredCardSummary(admin, userA, cardA, "2026-10-23")).toBeNull();

    await upload("8", [row("2026-10", "8")], userA, cardA, "2026-10-23", "2020-01-01T00:00:00+00:00");
    expect(await saveCardSummary(cardSummary("2026-10-23", "e", "탈퇴 정리 요약"))).toEqual({ kind: "saved" });
    // afterEach의 deleteTestUser가 요약이 남아 있어도 Auth cascade에서 성공해야 한다.
  });

  it("returns card_not_found for an unowned card", async () => {
    expect(await saveCardSummary({
      ...cardSummary("2026-10", "f", "요약"), cardId: "99999999-9999-4999-8999-999999999999",
    })).toEqual({ kind: "card_not_found" });
  });
});
