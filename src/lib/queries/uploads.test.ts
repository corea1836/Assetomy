import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getUploadOutcome, listDoneUploads } from "./uploads";

const uploadId = "22222222-2222-4222-8222-222222222222";
const done = { id: uploadId, status: "done", inserted_count: 2, duplicate_count: 3, skipped_count: 4,
  period_from: "2026-09-01", period_to: "2026-09-03", net_amount: -500 };

function fakeClient(data: unknown) {
  const builder = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  return { client: { from: vi.fn(() => builder) } as unknown as SupabaseClient, builder };
}

describe("getUploadOutcome", () => {
  it("maps a done summary and explicitly filters the user and upload", async () => {
    const { client, builder } = fakeClient(done);
    expect(await getUploadOutcome(client, "user-a", uploadId)).toEqual({
      status: "done", inserted: 2, duplicates: 3, skipped: 4,
      periodFrom: "2026-09-01", periodTo: "2026-09-03", netAmount: -500,
    });
    expect(builder.eq.mock.calls).toEqual([["user_id", "user-a"], ["id", uploadId]]);
    expect(builder.maybeSingle).toHaveBeenCalledOnce();
  });

  it("returns no_new with nullable dates and zero amounts", async () => {
    const { client } = fakeClient({ ...done, status: "no_new", inserted_count: 0,
      period_from: null, period_to: null, net_amount: 0 });
    expect(await getUploadOutcome(client, "user-a", uploadId)).toEqual({
      status: "no_new", inserted: 0, duplicates: 3, skipped: 4, periodFrom: null, periodTo: null, netAmount: 0,
    });
  });

  it.each(["processing", "failed"])("returns only the %s status", async (status) => {
    const { client } = fakeClient({ ...done, status, inserted_count: null, net_amount: null });
    expect(await getUploadOutcome(client, "user-a", uploadId)).toEqual({ status });
  });

  it("returns null when the scoped upload is absent", async () => {
    expect(await getUploadOutcome(fakeClient(null).client, "user-a", uploadId)).toBeNull();
  });

  it.each(["inserted_count", "duplicate_count", "skipped_count", "net_amount"])("validates safe integer %s", async (field) => {
    for (const value of [null, 1.5, 2 ** 53, NaN, Infinity, "500"]) {
      await expect(getUploadOutcome(fakeClient({ ...done, [field]: value }).client, "user-a", uploadId))
        .rejects.toMatchObject({ operation: "getUploadOutcome", code: "unexpected_response" });
    }
  });

  it.each(["inserted_count", "duplicate_count", "skipped_count"])("rejects negative %s", async (field) => {
    await expect(getUploadOutcome(fakeClient({ ...done, [field]: -1 }).client, "user-a", uploadId))
      .rejects.toMatchObject({ code: "unexpected_response" });
  });

  it.each(["period_from", "period_to"])("validates %s as an ISO date", async (field) => {
    for (const value of ["2026-9-3", "2026-02-30", "2026-09-03T00:00:00Z", 123]) {
      await expect(getUploadOutcome(fakeClient({ ...done, [field]: value }).client, "user-a", uploadId))
        .rejects.toMatchObject({ code: "unexpected_response" });
    }
  });

  it.each([{ ...done, id: "invalid" }, { ...done, status: "unknown" }, {}, []])(
    "rejects malformed rows: %j", async (data) => {
      await expect(getUploadOutcome(fakeClient(data).client, "user-a", uploadId))
        .rejects.toMatchObject({ code: "unexpected_response" });
    },
  );
});

function fakeListClient(pages: unknown[]) {
  const builder = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    range: vi.fn(async () => ({ data: pages.shift(), error: null })),
  };
  const from = vi.fn(() => builder);
  return { client: { from } as unknown as SupabaseClient, from, builder };
}

function doneRow(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    card_id: "33333333-3333-4333-8333-333333333333", file_name: `파일 ${index}.pdf`,
    inserted_count: index + 1, period_from: "2026-09-12", period_to: "2026-10-11",
  };
}

describe("listDoneUploads", () => {
  it("reads every done upload page newest first, scoped to the user, and maps the record", async () => {
    const first = Array.from({ length: 1000 }, (_, index) => doneRow(index));
    const { client, from, builder } = fakeListClient([first, [doneRow(1000)]]);
    const uploads = await listDoneUploads(client, "user-a");
    expect(uploads).toHaveLength(1001);
    expect(uploads[0]).toEqual({
      id: first[0].id, cardId: "33333333-3333-4333-8333-333333333333", fileName: "파일 0.pdf",
      inserted: 1, periodFrom: "2026-09-12", periodTo: "2026-10-11",
    });
    expect(from.mock.calls).toEqual([["uploads"], ["uploads"]]);
    expect(builder.select.mock.calls[0]).toEqual(["id, card_id, file_name, inserted_count, period_from, period_to"]);
    expect(builder.eq.mock.calls).toEqual([
      ["user_id", "user-a"], ["status", "done"], ["user_id", "user-a"], ["status", "done"],
    ]);
    expect(builder.order.mock.calls).toEqual([
      ["created_at", { ascending: false }], ["id", { ascending: false }],
      ["created_at", { ascending: false }], ["id", { ascending: false }],
    ]);
    expect(builder.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it("returns an empty list when nothing is done", async () => {
    expect(await listDoneUploads(fakeListClient([[]]).client, "user-a")).toEqual([]);
  });

  it.each([
    null, [{ ...doneRow(0), id: "invalid" }], [{ ...doneRow(0), inserted_count: 0 }],
    [{ ...doneRow(0), period_from: null }], [{ ...doneRow(0), period_to: "2026-02-30" }],
    [{ ...doneRow(0), file_name: "" }],
  ])("rejects malformed rows: %j", async (data) => {
    await expect(listDoneUploads(fakeListClient([data]).client, "user-a"))
      .rejects.toMatchObject({ operation: "listDoneUploads", code: "unexpected_response" });
  });
});
