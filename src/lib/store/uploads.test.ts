import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BeginUploadInput, IngestUploadInput } from "@/types/upload";
import { beginUpload, deleteUpload, failUpload, ingestUpload } from "./uploads";
import { StoreError } from "./store-error";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => ({ rpc })) }));
beforeEach(() => { vi.clearAllMocks(); rpc.mockReset(); });

const uploadId = "22222222-2222-4222-8222-222222222222";
const cardId = "11111111-1111-4111-8111-111111111111";
const leaseExpiresAt = "2026-10-13T00:06:00.123456+00:00";
const beginInput: BeginUploadInput = {
  userId: "user-a", cardId, fileName: "이용내역.pdf", fileHash: "a".repeat(64), fileSize: 100,
};
const ingestInput: IngestUploadInput = {
  userId: "user-a", uploadId, identityScope: "content", cancelStyle: "negative_amount",
  skipped: 2,
  rows: [{
    usedOn: "2026-09-03", merchant: "예시 가맹점", merchantKey: "예시가맹점",
    amount: -500, eventKind: "cancel", category: "food", fingerprint: "b".repeat(64),
  }],
};
const summary = { inserted: 1, duplicates: 0, skipped: 2, period_from: "2026-09-03", period_to: "2026-09-03", net_amount: -500 };
const camelSummary = { inserted: 1, duplicates: 0, skipped: 2, periodFrom: "2026-09-03", periodTo: "2026-09-03", netAmount: -500 };
const statuses = ["processing", "done", "no_new", "failed"] as const;

describe("beginUpload", () => {
  it.each([
    { data: { kind: "started", upload_id: uploadId, lease_expires_at: leaseExpiresAt }, expected: { kind: "started", uploadId, leaseExpiresAt } },
    { data: { kind: "duplicate", existing_card_id: cardId }, expected: { kind: "duplicate", existingCardId: cardId } },
    ...["card_not_found", "rate_limited", "busy"].map((kind) => ({ data: { kind }, expected: { kind } })),
  ])("maps $data.kind and passes only snake_case input", async ({ data, expected }) => {
    rpc.mockResolvedValue({ data, error: null });
    expect(await beginUpload(beginInput)).toEqual(expected);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("begin_upload", {
      p_user_id: "user-a", p_card_id: cardId, p_file_name: "이용내역.pdf",
      p_file_hash: "a".repeat(64), p_file_size: 100,
    });
  });

  it.each([null, { kind: "unknown" }, { kind: "started", upload_id: uploadId, lease_expires_at: "tomorrow" }])(
    "rejects malformed begin responses: %j", async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      await expect(beginUpload(beginInput)).rejects.toMatchObject({ code: "unexpected_response", operation: "begin_upload" });
    },
  );
});

describe("ingestUpload", () => {
  it.each([
    { data: { kind: "done", ...summary }, expected: { kind: "done", ...camelSummary } },
    { data: { kind: "no_new", inserted: 0, duplicates: 1, skipped: 2, period_from: null, period_to: null, net_amount: 0 },
      expected: { kind: "no_new", inserted: 0, duplicates: 1, skipped: 2, periodFrom: null, periodTo: null, netAmount: 0 } },
    { data: { kind: "duplicate", existing_card_id: cardId }, expected: { kind: "duplicate", existingCardId: cardId } },
    ...["not_found", "lease_expired", "card_scope_mismatch"].map((kind) => ({ data: { kind }, expected: { kind } })),
    ...statuses.map((status) => ({ data: { kind: "not_processing", status }, expected: { kind: "not_processing", status } })),
  ])("maps $data.kind and serializes rows to SQL keys", async ({ data, expected }) => {
    rpc.mockResolvedValue({ data, error: null });
    expect(await ingestUpload(ingestInput)).toEqual(expected);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("ingest_upload", {
      p_user_id: "user-a", p_upload_id: uploadId, p_identity_scope: "content", p_cancel_style: "negative_amount",
      p_skipped: 2, p_rows: [{
        used_on: "2026-09-03", merchant: "예시 가맹점", merchant_key: "예시가맹점",
        amount: -500, event_kind: "cancel", category: "food", fingerprint: "b".repeat(64),
      }],
    });
  });

  it.each(["inserted", "duplicates", "skipped", "net_amount"])("rejects unsafe or fractional %s", async (field) => {
    for (const value of [1.5, 2 ** 53, NaN, Infinity, "500"]) {
      rpc.mockResolvedValue({ data: { kind: "done", ...summary, [field]: value }, error: null });
      const error = await ingestUpload(ingestInput).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(StoreError);
      expect(error).toMatchObject({ code: "unexpected_response", operation: "ingest_upload" });
    }
  });

  it.each(["inserted", "duplicates", "skipped"])("rejects negative %s", async (field) => {
    rpc.mockResolvedValue({ data: { kind: "done", ...summary, [field]: -1 }, error: null });
    await expect(ingestUpload(ingestInput)).rejects.toMatchObject({ code: "unexpected_response" });
  });

  it.each(["period_from", "period_to"])("rejects invalid %s", async (field) => {
    for (const value of ["2026-9-3", "2026-02-30", "2026-09-03T00:00:00Z", 123, "invalid"]) {
      rpc.mockResolvedValue({ data: { kind: "done", ...summary, [field]: value }, error: null });
      await expect(ingestUpload(ingestInput)).rejects.toMatchObject({ code: "unexpected_response" });
    }
  });

  it.each([null, { kind: "unknown" }, { kind: "done" }, { kind: "not_processing", status: "needs_mapping" }])(
    "rejects malformed ingest responses: %j", async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      await expect(ingestUpload(ingestInput)).rejects.toMatchObject({ code: "unexpected_response" });
    },
  );
});

describe("failUpload", () => {
  it.each([
    ...["failed", "not_found"].map((kind) => ({ kind })),
    ...statuses.map((status) => ({ kind: "not_processing", status })),
  ])("maps %j and forwards the failure code and reason", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    expect(await failUpload("user-a", uploadId, "UNREADABLE", "total_mismatch")).toEqual(data);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("fail_upload", {
      p_user_id: "user-a", p_upload_id: uploadId, p_code: "UNREADABLE", p_reason: "total_mismatch",
    });
  });

  it("sends null for an omitted reason", async () => {
    rpc.mockResolvedValue({ data: { kind: "failed" }, error: null });
    await failUpload("user-a", uploadId, "UNREADABLE");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("fail_upload", {
      p_user_id: "user-a", p_upload_id: uploadId, p_code: "UNREADABLE", p_reason: null,
    });
  });
});

describe("deleteUpload", () => {
  it.each(["deleted", "not_found", "processing"])("maps %s and sends exact arguments", async (kind) => {
    rpc.mockResolvedValue({ data: { kind }, error: null });
    expect(await deleteUpload("user-a", uploadId)).toEqual({ kind });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("delete_upload", { p_user_id: "user-a", p_upload_id: uploadId });
  });
});

const operations = [
  { name: "begin_upload", call: () => beginUpload(beginInput) },
  { name: "ingest_upload", call: () => ingestUpload(ingestInput) },
  { name: "fail_upload", call: () => failUpload("user-a", uploadId, "UNREADABLE") },
  { name: "delete_upload", call: () => deleteUpload("user-a", uploadId) },
];
describe("upload RPC errors", () => {
  it.each(operations)("$name retains the code without sensitive error fields", async ({ name, call }) => {
    rpc.mockResolvedValue({ data: null, error: {
      code: "23514", message: "비밀 가맹점명", details: "비밀 가맹점명", hint: "비밀 가맹점명",
    } });
    const error = await call().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StoreError);
    expect(error).toMatchObject({ code: "23514", operation: name, message: `store:${name}:23514` });
    expect(String(error)).not.toContain("비밀 가맹점명");
    expect(JSON.stringify(error)).not.toContain("비밀 가맹점명");
  });

  it.each(operations)("$name rejects unknown kinds", async ({ name, call }) => {
    rpc.mockResolvedValue({ data: { kind: "unknown" }, error: null });
    await expect(call()).rejects.toThrowError(`store:${name}:unexpected_response`);
  });

  it.each(operations)("$name sanitizes rejected RPC promises", async ({ name, call }) => {
    rpc.mockRejectedValue(new Error("비밀 가맹점명"));
    await expect(call()).rejects.toThrowError(`store:${name}:unexpected_response`);
  });
});
