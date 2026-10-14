import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionUser } from "@/lib/auth";
import { saveSummaryFeedback } from "@/lib/store/summary-feedback";
import { CATEGORY_IDS } from "@/types/category";
import { PUT } from "./route";

vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/store/summary-feedback", () => ({ saveSummaryFeedback: vi.fn() }));

const userId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  vi.mocked(getSessionUser).mockResolvedValue({ id: userId });
  vi.mocked(saveSummaryFeedback).mockResolvedValue({ kind: "saved" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function feedbackRequest({
  origin = "http://localhost:3000", contentType = "application/json",
  body = JSON.stringify({ category: "cafe", text: "평일 오전 커피" }),
}: { origin?: string | null; contentType?: string | null; body?: string } = {}): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  if (contentType !== null) headers.set("content-type", contentType);
  const request = new Request("http://localhost:3000/api/summary-feedback", { method: "PUT", headers, body });
  if (contentType === null) request.headers.delete("content-type");
  return request;
}

describe("PUT /api/summary-feedback", () => {
  it("returns 401 before inspecting Origin or the body", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const request = feedbackRequest({ origin: null, contentType: "text/plain", body: "{" });
    const json = vi.spyOn(request, "json");
    const response = await PUT(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHORIZED" } });
    expect(json).not.toHaveBeenCalled();
    expect(saveSummaryFeedback).not.toHaveBeenCalled();
  });

  it.each([null, "https://evil.example", "http://localhost:3000/"])("rejects Origin %s", async (origin) => {
    const request = feedbackRequest({ origin, contentType: "text/plain", body: "{" });
    const json = vi.spyOn(request, "json");
    const response = await PUT(request);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "FORBIDDEN" } });
    expect(json).not.toHaveBeenCalled();
    expect(saveSummaryFeedback).not.toHaveBeenCalled();
  });

  it.each([null, "text/plain", "multipart/form-data", "application/jsonp"])(
    "preserves checkMutationRequest's response for Content-Type %s", async (contentType) => {
      const request = feedbackRequest({ contentType });
      const json = vi.spyOn(request, "json");
      const response = await PUT(request);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST" } });
      expect(json).not.toHaveBeenCalled();
      expect(saveSummaryFeedback).not.toHaveBeenCalled();
    },
  );

  it.each([
    "{", "null", "[]", "{}", JSON.stringify({ category: "unknown", text: "피드백" }),
    JSON.stringify({ category: "food", text: 123 }), JSON.stringify({ category: "food" }),
    JSON.stringify({ text: "피드백" }), JSON.stringify({ category: "food", text: "x".repeat(1001) }),
  ])("rejects malformed JSON or input %s", async (body) => {
    const response = await PUT(feedbackRequest({ body }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST" } });
    expect(saveSummaryFeedback).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("normalizes feedback before checking the 100 code point limit", async () => {
    const overLimit = await PUT(feedbackRequest({ body: JSON.stringify({ category: "food", text: `${"가".repeat(99)} \n 가` }) }));
    expect(overLimit.status).toBe(400);
    expect(saveSummaryFeedback).not.toHaveBeenCalled();

    const response = await PUT(feedbackRequest({ body: JSON.stringify({ category: "food", text: "가".repeat(100) }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    expect(saveSummaryFeedback).toHaveBeenCalledExactlyOnceWith(userId, "food", "가".repeat(100));
  });

  it("collapses whitespace and ignores request identity fields", async () => {
    const response = await PUT(feedbackRequest({ body: JSON.stringify({
      category: "cafe", text: "  평일\n오전  커피 ", user_id: "untrusted", userId: "untrusted",
    }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    expect(saveSummaryFeedback).toHaveBeenCalledExactlyOnceWith(userId, "cafe", "평일 오전 커피");
  });

  it.each(["", "   \n  "])("saves empty normalized text to delete and returns deleted", async (text) => {
    vi.mocked(saveSummaryFeedback).mockResolvedValue({ kind: "deleted" });
    const response = await PUT(feedbackRequest({ body: JSON.stringify({ category: "cafe", text }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(saveSummaryFeedback).toHaveBeenCalledExactlyOnceWith(userId, "cafe", "");
  });

  it.each(CATEGORY_IDS)("accepts each fixed category: %s", async (category) => {
    const response = await PUT(feedbackRequest({ body: JSON.stringify({ category, text: "힌트" }) }));
    expect(response.status).toBe(200);
    expect(saveSummaryFeedback).toHaveBeenCalledExactlyOnceWith(userId, category, "힌트");
  });

  it("returns 503 and logs only the error class and session id on store failure", async () => {
    vi.mocked(saveSummaryFeedback).mockRejectedValue(new TypeError("PRIVATE_FEEDBACK_TEXT"));
    const response = await PUT(feedbackRequest({ body: JSON.stringify({ category: "food", text: "PRIVATE_FEEDBACK_TEXT" }) }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
    expect(console.error).toHaveBeenCalledExactlyOnceWith("summary_feedback:TypeError", userId);
    expect(JSON.stringify(body)).not.toContain("PRIVATE_FEEDBACK_TEXT");
  });
});
