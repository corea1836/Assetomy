import { describe, expect, it, vi } from "vitest";
import type { CategoryId } from "@/types/category";
import type { ParseFailure, ParsedTransaction, ParseSuccess } from "@/types/parsing";
import type { IngestUploadResult, ProcessUploadInput, UploadOutcomeRecord, UploadSummary } from "@/types/upload";
import { transactionFingerprint } from "./fingerprint";
import { processUpload, type ProcessUploadDeps } from "./process-upload";

const userId = "11111111-1111-4111-8111-111111111111";
const cardId = "abcdef01-2345-4678-9abc-def012345678";
const uploadId = "22222222-2222-4222-8222-222222222222";
const input: ProcessUploadInput = {
  userId, cardId: cardId.toUpperCase(), fileName: "synthetic.pdf",
  bytes: new TextEncoder().encode("%PDF-synthetic"),
};
const transactions: ParsedTransaction[] = [
  { date: "2026-09-01", merchant: "스타벅스 강남", merchantKey: "스타벅스 강남",
    amount: 5500, eventKind: "purchase", sourceEventKey: "2026-09-01|스타벅스 강남|5500|0" },
  { date: "2026-09-02", merchant: "표시명 A", merchantKey: "A",
    amount: 10000, eventKind: "purchase", sourceEventKey: "2026-09-02|A|10000|0" },
  { date: "2026-09-03", merchant: "표시명 A 두 번째", merchantKey: "A",
    amount: -500, eventKind: "cancel", sourceEventKey: "2026-09-03|A|-500|0" },
];
const parsed: ParseSuccess = {
  ok: true, profile: "hyundai_statement_pdf", identityScope: "content",
  cancelStyle: "negative_amount", statementTotal: 15000, transactions,
};
const summary: UploadSummary = {
  inserted: 3, duplicates: 0, skipped: 0,
  periodFrom: "2026-09-01", periodTo: "2026-09-03", netAmount: 15000,
};

function fakeDeps() {
  return {
    today: "2026-10-13",
    beginUpload: vi.fn<ProcessUploadDeps["beginUpload"]>().mockResolvedValue({
      kind: "started", uploadId, leaseExpiresAt: "2026-10-13T01:06:00Z",
    }),
    saveStatement: vi.fn<ProcessUploadDeps["saveStatement"]>().mockResolvedValue(undefined),
    readStatement: vi.fn<ProcessUploadDeps["readStatement"]>().mockResolvedValue(parsed),
    findMerchantCategories: vi.fn<ProcessUploadDeps["findMerchantCategories"]>()
      .mockResolvedValue(new Map<string, CategoryId>([["A", "shopping"]])),
    classifier: { classify: vi.fn<ProcessUploadDeps["classifier"]["classify"]>()
      .mockResolvedValue(new Map<string, CategoryId>([["스타벅스 강남", "cafe"]])) },
    ingestUpload: vi.fn<ProcessUploadDeps["ingestUpload"]>().mockResolvedValue({ kind: "done", ...summary }),
    failUpload: vi.fn<ProcessUploadDeps["failUpload"]>().mockResolvedValue({ kind: "failed" }),
    getUploadOutcome: vi.fn<ProcessUploadDeps["getUploadOutcome"]>().mockResolvedValue(null),
  } satisfies ProcessUploadDeps;
}

describe("processUpload", () => {
  it.each([
    { kind: "card_not_found" }, { kind: "rate_limited" }, { kind: "busy" },
    { kind: "duplicate", existingCardId: cardId },
  ] as const)("returns begin result $kind without saving or parsing", async (result) => {
    const deps = fakeDeps();
    deps.beginUpload.mockResolvedValue(result);
    expect(await processUpload(input, deps)).toEqual(result);
    expect(deps.saveStatement).not.toHaveBeenCalled();
    expect(deps.readStatement).not.toHaveBeenCalled();
    expect(deps.findMerchantCategories).not.toHaveBeenCalled();
    expect(deps.ingestUpload).not.toHaveBeenCalled();
    expect(deps.failUpload).not.toHaveBeenCalled();
  });

  it("returns a null upload ID if begin throws", async () => {
    const deps = fakeDeps();
    deps.beginUpload.mockRejectedValue(new Error("unavailable"));
    expect(await processUpload(input, deps)).toEqual({ kind: "temporary_failure", uploadId: null });
    expect(deps.saveStatement).not.toHaveBeenCalled();
    expect(deps.readStatement).not.toHaveBeenCalled();
    expect(deps.failUpload).not.toHaveBeenCalled();
  });

  it("saves before parsing, uses a lowercase card ID, and ingests categorized fingerprints", async () => {
    const deps = fakeDeps();
    expect(await processUpload(input, deps)).toEqual({ kind: "done", uploadId, ...summary });
    expect(deps.beginUpload).toHaveBeenCalledExactlyOnceWith({
      userId, cardId, fileName: input.fileName, fileSize: input.bytes.byteLength,
      fileHash: "a01de6a6a86f3503b20a3a18ba0e5cca91f7ab089e7ab0d2e559297331b7294b",
    });
    expect(deps.saveStatement).toHaveBeenCalledExactlyOnceWith(userId, uploadId, input.bytes);
    expect(deps.saveStatement.mock.calls[0][2]).toBe(input.bytes);
    expect(deps.readStatement).toHaveBeenCalledExactlyOnceWith(input.bytes);
    expect(deps.readStatement.mock.calls[0][0]).toBe(input.bytes);
    expect(deps.saveStatement.mock.invocationCallOrder[0]).toBeLessThan(deps.readStatement.mock.invocationCallOrder[0]);
    expect(deps.ingestUpload).toHaveBeenCalledExactlyOnceWith({
      userId, uploadId, identityScope: "content", cancelStyle: "negative_amount", skipped: 0,
      rows: transactions.map((transaction) => ({
        usedOn: transaction.date, merchant: transaction.merchant, merchantKey: transaction.merchantKey,
        amount: transaction.amount, eventKind: transaction.eventKind,
        category: transaction.merchantKey === "A" ? "shopping" : "cafe",
        fingerprint: transactionFingerprint({ cardId, identityScope: parsed.identityScope,
          sourceEventKey: transaction.sourceEventKey, eventKind: transaction.eventKind }),
      })),
    });
    expect(deps.failUpload).not.toHaveBeenCalled();
    expect(deps.getUploadOutcome).not.toHaveBeenCalled();
  });

  it("keeps the cutoff date and skips earlier transactions before categorization", async () => {
    const deps = fakeDeps();
    const expired = { ...transactions[0], date: "2025-10-12", merchantKey: "expired" };
    const boundary = { ...transactions[1], date: "2025-10-13" };
    deps.readStatement.mockResolvedValue({ ...parsed, transactions: [expired, boundary] });
    await processUpload(input, deps);
    expect(deps.findMerchantCategories).toHaveBeenCalledExactlyOnceWith(["A"]);
    expect(deps.classifier.classify).not.toHaveBeenCalled();
    expect(deps.ingestUpload.mock.calls[0][0]).toMatchObject({ skipped: 1, rows: [{ usedOn: "2025-10-13" }] });
  });

  it("ingests empty rows when all transactions have expired", async () => {
    const deps = fakeDeps();
    deps.readStatement.mockResolvedValue({ ...parsed,
      transactions: transactions.map((transaction) => ({ ...transaction, date: "2025-10-12" })),
    });
    const result = { kind: "no_new" as const, inserted: 0, duplicates: 0, skipped: 3,
      periodFrom: null, periodTo: null, netAmount: 0 };
    deps.ingestUpload.mockResolvedValue(result);
    expect(await processUpload(input, deps)).toEqual({ ...result, uploadId });
    expect(deps.ingestUpload).toHaveBeenCalledExactlyOnceWith({
      userId, uploadId, identityScope: "content", cancelStyle: "negative_amount", skipped: 3, rows: [],
    });
    expect(deps.classifier.classify).not.toHaveBeenCalled();
  });

  it("queries unique keys once and classifies only missing keys with their first display name", async () => {
    const deps = fakeDeps();
    deps.findMerchantCategories.mockResolvedValue(new Map([["스타벅스 강남", "health"]]));
    deps.classifier.classify.mockResolvedValue(new Map([["A", "food"]]));
    await processUpload(input, deps);
    expect(deps.findMerchantCategories).toHaveBeenCalledExactlyOnceWith(["스타벅스 강남", "A"]);
    expect(deps.classifier.classify).toHaveBeenCalledExactlyOnceWith([{ merchantKey: "A", merchant: "표시명 A" }]);
    expect(deps.ingestUpload.mock.calls[0][0].rows.map((row) => row.category)).toEqual(["health", "food", "food"]);
  });

  it.each(["throw", "missing"])("falls back to etc when classification is %s", async (failure) => {
    const deps = fakeDeps();
    if (failure === "throw") deps.classifier.classify.mockRejectedValue(new Error("unavailable"));
    else deps.classifier.classify.mockResolvedValue(new Map());
    await processUpload(input, deps);
    expect(deps.classifier.classify).toHaveBeenCalledExactlyOnceWith([
      { merchantKey: "스타벅스 강남", merchant: "스타벅스 강남" },
    ]);
    expect(deps.ingestUpload.mock.calls[0][0].rows.map((row) => row.category)).toEqual(["etc", "shopping", "shopping"]);
    expect(deps.failUpload).not.toHaveBeenCalled();
  });

  it.each([
    { ok: false, code: "UNREADABLE", reason: "total_mismatch" },
    { ok: false, code: "UNSUPPORTED_FILE", reason: "unknown_format" },
  ] satisfies ParseFailure[])("ends a parsing rejection with $code/$reason", async (failure) => {
    const deps = fakeDeps();
    deps.readStatement.mockResolvedValue(failure);
    expect(await processUpload(input, deps)).toEqual({ kind: "rejected", uploadId, code: failure.code, reason: failure.reason });
    expect(deps.failUpload).toHaveBeenCalledExactlyOnceWith(userId, uploadId, failure.code, failure.reason);
    expect(deps.findMerchantCategories).not.toHaveBeenCalled();
    expect(deps.ingestUpload).not.toHaveBeenCalled();
  });

  it.each([
    ["saveStatement", "storage"], ["readStatement", "parser"], ["findMerchantCategories", "categories"],
  ] as const)("ends a %s failure with INTERNAL_ERROR/%s", async (dependency, reason) => {
    const deps = fakeDeps();
    deps[dependency].mockRejectedValue(new Error("unavailable"));
    expect(await processUpload(input, deps)).toEqual({ kind: "temporary_failure", uploadId });
    expect(deps.failUpload).toHaveBeenCalledExactlyOnceWith(userId, uploadId, "INTERNAL_ERROR", reason);
    expect(deps.ingestUpload).not.toHaveBeenCalled();
    expect(deps.classifier.classify).not.toHaveBeenCalled();
    if (dependency === "saveStatement") expect(deps.readStatement).not.toHaveBeenCalled();
    if (dependency !== "findMerchantCategories") expect(deps.findMerchantCategories).not.toHaveBeenCalled();
  });

  it.each(["storage", "parser", "categories", "rejected"])("preserves the %s outcome when failUpload throws", async (failure) => {
    const deps = fakeDeps();
    deps.failUpload.mockRejectedValue(new Error("unavailable"));
    if (failure === "rejected") {
      deps.readStatement.mockResolvedValue({ ok: false, code: "UNREADABLE", reason: "total_mismatch" });
    } else {
      const dependency = { storage: deps.saveStatement, parser: deps.readStatement, categories: deps.findMerchantCategories }[failure];
      dependency!.mockRejectedValue(new Error("unavailable"));
    }
    expect(await processUpload(input, deps)).toEqual(failure === "rejected"
      ? { kind: "rejected", uploadId, code: "UNREADABLE", reason: "total_mismatch" }
      : { kind: "temporary_failure", uploadId });
    expect(deps.failUpload).toHaveBeenCalledExactlyOnceWith(userId, uploadId,
      failure === "rejected" ? "UNREADABLE" : "INTERNAL_ERROR",
      failure === "rejected" ? "total_mismatch" : failure);
  });

  it.each([
    [{ kind: "duplicate", existingCardId: cardId }, { kind: "duplicate", existingCardId: cardId }],
    [{ kind: "card_scope_mismatch" }, { kind: "card_scope_mismatch", uploadId }],
    [{ kind: "lease_expired" }, { kind: "temporary_failure", uploadId }],
    [{ kind: "not_found" }, { kind: "temporary_failure", uploadId }],
  ] as const)("maps the ingest result %j", async (result, expected) => {
    const deps = fakeDeps();
    deps.ingestUpload.mockResolvedValue(result);
    expect(await processUpload(input, deps)).toEqual(expected);
    expect(deps.failUpload).not.toHaveBeenCalled();
    expect(deps.getUploadOutcome).not.toHaveBeenCalled();
  });

  describe.each(["throw", "not_processing"])("ambiguous ingest: %s", (ambiguous) => {
    function ambiguousDeps() {
      const deps = fakeDeps();
      if (ambiguous === "throw") deps.ingestUpload.mockRejectedValue(new Error("unavailable"));
      else deps.ingestUpload.mockResolvedValue({ kind: "not_processing", status: "done" } satisfies IngestUploadResult);
      return deps;
    }

    it.each(["done", "no_new"] as const)("recovers the persisted %s summary with one read", async (status) => {
      const deps = ambiguousDeps();
      const saved = status === "done" ? summary
        : { inserted: 0, duplicates: 3, skipped: 1, periodFrom: null, periodTo: null, netAmount: 0 };
      deps.getUploadOutcome.mockResolvedValue({ status, ...saved });
      expect(await processUpload(input, deps)).toEqual({ kind: status, uploadId, ...saved });
      expect(deps.getUploadOutcome).toHaveBeenCalledExactlyOnceWith(uploadId);
      expect(deps.failUpload).not.toHaveBeenCalled();
    });

    it.each([{ status: "processing" }, { status: "failed" }, null] satisfies (UploadOutcomeRecord | null)[])(
      "preserves an unresolved row: %j", async (record) => {
        const deps = ambiguousDeps();
        deps.getUploadOutcome.mockResolvedValue(record);
        expect(await processUpload(input, deps)).toEqual({ kind: "temporary_failure", uploadId });
        expect(deps.getUploadOutcome).toHaveBeenCalledExactlyOnceWith(uploadId);
        expect(deps.failUpload).not.toHaveBeenCalled();
      },
    );

    it("preserves the row if the recovery query also throws", async () => {
      const deps = ambiguousDeps();
      deps.getUploadOutcome.mockRejectedValue(new Error("unavailable"));
      expect(await processUpload(input, deps)).toEqual({ kind: "temporary_failure", uploadId });
      expect(deps.getUploadOutcome).toHaveBeenCalledExactlyOnceWith(uploadId);
      expect(deps.failUpload).not.toHaveBeenCalled();
    });
  });
});
