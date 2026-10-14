import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionUser } from "@/lib/auth";
import { updateCard } from "@/lib/store/cards";
import { PUT } from "./route";

vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/store/cards", () => ({ updateCard: vi.fn() }));

const userId = "11111111-1111-4111-8111-111111111111";
const cardId = "22222222-2222-4222-8222-222222222222";
const validBody = {
  label: "  여행 카드  ", analysisBasis: "cycle", cycleStartDay: 12,
  userId: "untrusted-user", issuer: "shinhan", cardId: "untrusted-card",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  vi.mocked(getSessionUser).mockResolvedValue({ id: userId });
  vi.mocked(updateCard).mockResolvedValue({ kind: "updated" });
});
afterEach(() => vi.unstubAllEnvs());

function request({
  origin = "http://localhost:3000", contentType = "application/json", body = JSON.stringify(validBody),
}: { origin?: string | null; contentType?: string | null; body?: string } = {}): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  if (contentType !== null) headers.set("content-type", contentType);
  const result = new Request(`http://localhost:3000/api/cards/${cardId}`, { method: "PUT", headers, body });
  if (contentType === null) result.headers.delete("content-type");
  return result;
}

function params(id = cardId) {
  return { params: Promise.resolve({ id }) };
}

describe("PUT /api/cards/[id]", () => {
  it("returns 401 before checking Origin, content type, params, or reading the body", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const req = request({ origin: null, contentType: "text/plain", body: "{" });
    const json = vi.spyOn(req, "json");
    const response = await PUT(req, params("invalid"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHORIZED" } });
    expect(json).not.toHaveBeenCalled();
    expect(updateCard).not.toHaveBeenCalled();
  });

  it.each([null, "null", "https://evil.example"])("returns 403 for Origin %s", async (origin) => {
    const response = await PUT(request({ origin }), params());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "FORBIDDEN" } });
    expect(updateCard).not.toHaveBeenCalled();
  });

  it.each([null, "text/plain", "multipart/form-data"])("returns 400 for content type %s", async (contentType) => {
    const response = await PUT(request({ contentType }), params());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST" } });
    expect(updateCard).not.toHaveBeenCalled();
  });

  it("returns 404 for invalid card ids", async () => {
    const response = await PUT(request(), params("not-a-uuid"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND" } });
    expect(updateCard).not.toHaveBeenCalled();
  });

  it.each(["{", "null", "[]", "{}", JSON.stringify({ ...validBody, label: 123 })])(
    "returns BAD_REQUEST for malformed body %s", async (body) => {
      const response = await PUT(request({ body }), params());
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST" } });
      expect(updateCard).not.toHaveBeenCalled();
    },
  );

  it.each([
    { label: "카드", analysisBasis: "unknown", cycleStartDay: null },
    { label: "카드", analysisBasis: "cycle", cycleStartDay: null },
    { label: "카드", analysisBasis: "month", cycleStartDay: 12 },
  ])("returns INVALID_CARD for invalid analysis basis input %#", async (body) => {
    const response = await PUT(request({ body: JSON.stringify(body) }), params());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_CARD" } });
    expect(updateCard).not.toHaveBeenCalled();
  });

  it("uses the session and lowercased path id, trims the label, and ignores issuer and body user IDs", async () => {
    const response = await PUT(request(), params(cardId.toUpperCase()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: true });
    expect(updateCard).toHaveBeenCalledExactlyOnceWith(userId, cardId, {
      label: "여행 카드", analysisBasis: "cycle", cycleStartDay: 12,
    });
  });

  it.each([
    [{ kind: "not_found" }, 404, "NOT_FOUND"],
    [{ kind: "invalid_label" }, 400, "INVALID_LABEL"],
    [{ kind: "duplicate_label" }, 409, "DUPLICATE_LABEL"],
  ] as const)("maps update result %s", async (result, status, code) => {
    vi.mocked(updateCard).mockResolvedValue(result);
    const response = await PUT(request(), params());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
  });

  it("returns 503 when updateCard throws without exposing its message", async () => {
    vi.mocked(updateCard).mockRejectedValue(new Error("PRIVATE_CARD_LABEL"));
    const response = await PUT(request(), params());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
  });
});
