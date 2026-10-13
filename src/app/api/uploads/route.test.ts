import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionUser } from "@/lib/auth";
import { processUpload } from "@/lib/ingest/process-upload";
import { readPdfStatement } from "@/lib/pdf/read-statement";
import { listCards } from "@/lib/queries/cards";
import { findMerchantCategories } from "@/lib/queries/merchant-categories";
import { getUploadOutcome } from "@/lib/queries/uploads";
import { saveStatement } from "@/lib/store/statements";
import { beginUpload, failUpload, ingestUpload } from "@/lib/store/uploads";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMerchantClassifier } from "@/services/llm";
import type { ApiErrorCode, ProcessUploadOutcome, UploadSummary } from "@/types/upload";
import { maxDuration, POST } from "./route";

vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/ingest/process-upload", () => ({ processUpload: vi.fn() }));
vi.mock("@/lib/pdf/read-statement", () => ({ readPdfStatement: vi.fn() }));
vi.mock("@/lib/queries/cards", () => ({ listCards: vi.fn() }));
vi.mock("@/lib/queries/merchant-categories", () => ({ findMerchantCategories: vi.fn() }));
vi.mock("@/lib/queries/uploads", () => ({ getUploadOutcome: vi.fn() }));
vi.mock("@/lib/store/statements", () => ({ saveStatement: vi.fn() }));
vi.mock("@/lib/store/uploads", () => ({ beginUpload: vi.fn(), failUpload: vi.fn(), ingestUpload: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/services/llm", () => ({ getMerchantClassifier: vi.fn() }));

const userId = "11111111-1111-4111-8111-111111111111";
const cardId = "22222222-2222-4222-8222-222222222222";
const uploadId = "33333333-3333-4333-8333-333333333333";
const otherCardId = "44444444-4444-4444-8444-444444444444";
const summary: UploadSummary = {
  inserted: 2, duplicates: 1, skipped: 0, periodFrom: "2026-10-01", periodTo: "2026-10-12", netAmount: 12000,
};
const supabase = {} as SupabaseClient;
const classifier = { classify: vi.fn() };
const pdfBytes = new TextEncoder().encode("%PDF-synthetic");

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T15:30:00Z"));
  vi.mocked(getSessionUser).mockResolvedValue({ id: userId });
  vi.mocked(processUpload).mockResolvedValue({ kind: "done", uploadId, ...summary });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase);
  vi.mocked(getMerchantClassifier).mockReturnValue(classifier);
  vi.mocked(listCards).mockResolvedValue([{ id: otherCardId, label: "기존 카드" }]);
  vi.mocked(findMerchantCategories).mockResolvedValue(new Map([["merchant-key", "etc"]]));
  vi.mocked(getUploadOutcome).mockResolvedValue({ status: "done", ...summary });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function uploadRequest({
  origin = "http://localhost:3000", contentType, file = new File([pdfBytes], "statement.pdf"),
  selectedCardId = cardId, contentLength,
}: {
  origin?: string | null; contentType?: string | null; file?: File | string;
  selectedCardId?: string; contentLength?: string;
} = {}): Request {
  const form = new FormData();
  form.set("cardId", selectedCardId);
  form.set("file", file);
  form.set("userId", "untrusted-user");
  form.set("storage_path", "untrusted-path");
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  const request = new Request("http://localhost:3000/api/uploads", { method: "POST", headers, body: form });
  if (contentType === null) request.headers.delete("content-type");
  else if (contentType !== undefined) request.headers.set("content-type", contentType);
  return request;
}

async function expectError(response: Response, status: number, code: ApiErrorCode, reason?: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: { code, ...(reason === undefined ? {} : { reason }) } });
}

describe("POST /api/uploads", () => {
  it("keeps maxDuration below the six minute lease", () => {
    expect(maxDuration).toBe(300);
  });

  it("returns 401 JSON before checking Origin, content type or input", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const request = uploadRequest({ origin: null, contentType: "text/plain", contentLength: "5000000" });
    const formData = vi.spyOn(request, "formData");
    const response = await POST(request);
    await expectError(response, 401, "UNAUTHORIZED");
    expect(response.headers.has("location")).toBe(false);
    expect(formData).not.toHaveBeenCalled();
    expect(processUpload).not.toHaveBeenCalled();
    expect(beginUpload).not.toHaveBeenCalled();
    expect(saveStatement).not.toHaveBeenCalled();
  });

  it.each([null, "null", "https://evil.example"])("returns 403 for Origin %s", async (origin) => {
    await expectError(await POST(uploadRequest({ origin, contentType: "text/plain" })), 403, "FORBIDDEN");
    expect(processUpload).not.toHaveBeenCalled();
  });

  it.each([null, "text/plain", "application/json"])("returns 400 for content type %s", async (contentType) => {
    await expectError(await POST(uploadRequest({ contentType, contentLength: "5000000" })), 400, "BAD_REQUEST");
    expect(processUpload).not.toHaveBeenCalled();
  });

  it("rejects an oversized Content-Length without reading the body", async () => {
    const request = uploadRequest({ contentLength: "5000000" });
    const formData = vi.spyOn(request, "formData");
    await expectError(await POST(request), 422, "FILE_TOO_LARGE");
    expect(formData).not.toHaveBeenCalled();
    expect(processUpload).not.toHaveBeenCalled();
  });

  it("allows exactly 4MB plus 64KB of multipart Content-Length", async () => {
    const response = await POST(uploadRequest({ contentLength: String(4_194_304 + 65_536) }));
    expect(response.status).toBe(200);
    expect(processUpload).toHaveBeenCalledOnce();
  });

  it("rejects a multipart parsing failure", async () => {
    const request = uploadRequest();
    vi.spyOn(request, "formData").mockRejectedValue(new Error("PRIVATE_MULTIPART_ERROR"));
    await expectError(await POST(request), 400, "BAD_REQUEST");
    expect(processUpload).not.toHaveBeenCalled();
  });

  it.each(["", "not-a-uuid"])("rejects invalid cardId %s", async (selectedCardId) => {
    await expectError(await POST(uploadRequest({ selectedCardId })), 400, "BAD_REQUEST");
    expect(processUpload).not.toHaveBeenCalled();
  });

  it("requires a File rather than a string", async () => {
    await expectError(await POST(uploadRequest({ file: "statement.pdf" })), 400, "BAD_REQUEST");
    expect(processUpload).not.toHaveBeenCalled();
  });

  it("requires both multipart fields", async () => {
    const request = uploadRequest();
    vi.spyOn(request, "formData").mockResolvedValue(new FormData());
    await expectError(await POST(request), 400, "BAD_REQUEST");
    expect(processUpload).not.toHaveBeenCalled();
  });

  it("rejects a file larger than 4MB regardless of Content-Length", async () => {
    const file = new File([new Uint8Array(4_194_305)], "statement.pdf");
    await expectError(await POST(uploadRequest({ file, contentLength: "1" })), 422, "FILE_TOO_LARGE");
    expect(processUpload).not.toHaveBeenCalled();
  });

  it("allows a file exactly 4MB in size", async () => {
    const response = await POST(uploadRequest({ file: new File([new Uint8Array(4_194_304)], "statement.pdf") }));
    expect(response.status).toBe(200);
    expect(vi.mocked(processUpload).mock.calls[0][0].bytes.byteLength).toBe(4_194_304);
  });

  it("rejects empty files before checking the extension", async () => {
    await expectError(await POST(uploadRequest({ file: new File([], "empty.csv") })), 422, "UNSUPPORTED_FILE", "empty_file");
    expect(processUpload).not.toHaveBeenCalled();
  });

  it.each(["statement.csv", "statement.xlsx", "statement.pdf.exe"])("rejects non-PDF extension %s", async (name) => {
    await expectError(await POST(uploadRequest({ file: new File([pdfBytes], name) })), 422, "UNSUPPORTED_FILE", "not_pdf");
    expect(processUpload).not.toHaveBeenCalled();
  });

  it.each(["  statement.PDF  ", "nested\\statement.pdf", "nested/statement.pdf"])(
    "accepts and trims PDF filename %s", async (name) => {
      const response = await POST(uploadRequest({ file: new File([pdfBytes], name) }));
      expect(response.status).toBe(200);
      // Multipart parsers may remove the client-side directory component.
      expect(vi.mocked(processUpload).mock.calls[0][0].fileName.toLowerCase()).toMatch(/\.pdf$/);
    },
  );

  it("uses statement.pdf for a whitespace-only name", async () => {
    const response = await POST(uploadRequest({ file: new File([pdfBytes], "   ") }));
    expect(response.status).toBe(200);
    expect(vi.mocked(processUpload).mock.calls[0][0].fileName).toBe("statement.pdf");
  });

  it("bounds long filenames while retaining the extension", async () => {
    const name = `${"a".repeat(296)}.pdf`;
    const response = await POST(uploadRequest({ file: new File([pdfBytes], name) }));
    expect(response.status).toBe(200);
    const fileName = vi.mocked(processUpload).mock.calls[0][0].fileName;
    expect(fileName.length).toBeLessThanOrEqual(255);
    expect(fileName.endsWith(".pdf")).toBe(true);
  });

  it("binds session identity, Seoul today, server stores and RLS queries to processUpload", async () => {
    const response = await POST(uploadRequest());
    expect(response.status).toBe(200);
    expect(processUpload).toHaveBeenCalledOnce();
    const [input, deps] = vi.mocked(processUpload).mock.calls[0];
    expect(input).toEqual({ userId, cardId, fileName: "statement.pdf", bytes: pdfBytes });
    expect(deps).toMatchObject({ today: "2026-10-13", beginUpload, ingestUpload, failUpload, saveStatement,
      readStatement: readPdfStatement, classifier });
    expect(createSupabaseServerClient).toHaveBeenCalledOnce();
    expect(await deps.findMerchantCategories(["merchant-key"]))
      .toEqual(new Map([["merchant-key", "etc"]]));
    expect(findMerchantCategories).toHaveBeenCalledExactlyOnceWith(supabase, userId, ["merchant-key"]);
    expect(await deps.getUploadOutcome(uploadId)).toEqual({ status: "done", ...summary });
    expect(getUploadOutcome).toHaveBeenCalledExactlyOnceWith(supabase, userId, uploadId);
  });

  it.each(["done", "no_new"] as const)("returns a %s result DTO", async (kind) => {
    vi.mocked(processUpload).mockResolvedValue({ kind, uploadId, ...summary });
    const response = await POST(uploadRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { kind, uploadId, ...summary } });
    expect(listCards).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("looks up the existing card label for a duplicate using the session", async () => {
    vi.mocked(processUpload).mockResolvedValue({ kind: "duplicate", existingCardId: otherCardId });
    const response = await POST(uploadRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { kind: "duplicate", existingCardLabel: "기존 카드" } });
    expect(listCards).toHaveBeenCalledExactlyOnceWith(supabase, userId);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(["missing", "failed"])("returns a null duplicate label when lookup is %s", async (scenario) => {
    vi.mocked(processUpload).mockResolvedValue({ kind: "duplicate", existingCardId: otherCardId });
    if (scenario === "missing") vi.mocked(listCards).mockResolvedValue([{ id: cardId, label: "다른 카드" }]);
    else vi.mocked(listCards).mockRejectedValue(new Error("PRIVATE_QUERY_ERROR"));
    const response = await POST(uploadRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { kind: "duplicate", existingCardLabel: null } });
    expect(console.error).not.toHaveBeenCalled();
  });

  const errors: { outcome: ProcessUploadOutcome; status: number; code: ApiErrorCode; reason?: string }[] = [
    { outcome: { kind: "rejected", uploadId, code: "UNSUPPORTED_FILE", reason: "unknown_format" },
      status: 422, code: "UNSUPPORTED_FILE", reason: "unknown_format" },
    { outcome: { kind: "rejected", uploadId, code: "UNREADABLE", reason: "total_mismatch" },
      status: 422, code: "UNREADABLE", reason: "total_mismatch" },
    { outcome: { kind: "card_not_found" }, status: 404, code: "CARD_NOT_FOUND" },
    { outcome: { kind: "card_scope_mismatch", uploadId }, status: 409, code: "CARD_SCOPE_MISMATCH" },
    { outcome: { kind: "rate_limited" }, status: 429, code: "RATE_LIMITED" },
    { outcome: { kind: "busy" }, status: 429, code: "BUSY" },
    { outcome: { kind: "temporary_failure", uploadId }, status: 503, code: "TEMPORARY_FAILURE" },
    { outcome: { kind: "temporary_failure", uploadId: null }, status: 503, code: "TEMPORARY_FAILURE" },
  ];
  it.each(errors)("maps $outcome.kind to $status $code", async ({ outcome, status, code, reason }) => {
    vi.mocked(processUpload).mockResolvedValue(outcome);
    await expectError(await POST(uploadRequest()), status, code, reason);
    if (outcome.kind === "temporary_failure") {
      expect(console.error).toHaveBeenCalledExactlyOnceWith("upload:temporary_failure", outcome.uploadId ?? "-");
    } else expect(console.error).not.toHaveBeenCalled();
  });

  it("returns 503 and logs only the error class when processUpload throws", async () => {
    const error = new TypeError("PRIVATE_UPLOAD_ERROR statement.pdf");
    error.name = "PRIVATE_ERROR_NAME";
    vi.mocked(processUpload).mockRejectedValue(error);
    await expectError(await POST(uploadRequest()), 503, "TEMPORARY_FAILURE");
    expect(console.error).toHaveBeenCalledExactlyOnceWith("upload:TypeError", "-");
  });

  it("returns 503 without leaking a missing classifier key", async () => {
    vi.mocked(getMerchantClassifier).mockImplementation(() => { throw new Error("PRIVATE_CLASSIFIER_KEY"); });
    await expectError(await POST(uploadRequest()), 503, "TEMPORARY_FAILURE");
    expect(processUpload).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("upload:Error", "-");
  });

  it("returns 503 for a session lookup failure", async () => {
    vi.mocked(getSessionUser).mockRejectedValue(new Error("PRIVATE_SESSION_ERROR"));
    await expectError(await POST(uploadRequest()), 503, "TEMPORARY_FAILURE");
    expect(processUpload).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("upload:Error", "-");
  });
});
