import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getUploadOutcome } from "./uploads";

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
