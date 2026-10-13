import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionUser } from "@/lib/auth";
import { createCard } from "@/lib/store/cards";
import { POST } from "./route";

vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/store/cards", () => ({ createCard: vi.fn() }));

const userId = "11111111-1111-4111-8111-111111111111";
const cardId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  vi.mocked(getSessionUser).mockResolvedValue({ id: userId });
  vi.mocked(createCard).mockResolvedValue({ kind: "created", cardId });
});
afterEach(() => vi.unstubAllEnvs());

function cardRequest({
  origin = "http://localhost:3000", contentType = "application/json",
  body = JSON.stringify({ label: "  생활비 카드  ", userId: "untrusted-user", storage_path: "untrusted-path" }),
}: { origin?: string | null; contentType?: string | null; body?: string } = {}): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  if (contentType !== null) headers.set("content-type", contentType);
  const request = new Request("http://localhost:3000/api/cards", { method: "POST", headers, body });
  if (contentType === null) request.headers.delete("content-type");
  return request;
}

describe("POST /api/cards", () => {
  it("returns 401 JSON before checking Origin, content type or input", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const request = cardRequest({ origin: null, contentType: "text/plain", body: "{" });
    const json = vi.spyOn(request, "json");
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHORIZED" } });
    expect(response.headers.has("location")).toBe(false);
    expect(json).not.toHaveBeenCalled();
    expect(createCard).not.toHaveBeenCalled();
  });

  it.each([null, "null", "https://evil.example"])("returns 403 for Origin %s", async (origin) => {
    const response = await POST(cardRequest({ origin, contentType: "text/plain" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "FORBIDDEN" } });
    expect(createCard).not.toHaveBeenCalled();
  });

  it.each([null, "text/plain", "multipart/form-data"])("returns 400 for content type %s", async (contentType) => {
    const response = await POST(cardRequest({ contentType }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST" } });
    expect(createCard).not.toHaveBeenCalled();
  });

  it("creates a card with the session user and returns the trimmed label", async () => {
    const response = await POST(cardRequest({ contentType: "Application/JSON; charset=utf-8" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ card: { id: cardId, label: "생활비 카드" } });
    expect(createCard).toHaveBeenCalledExactlyOnceWith(userId, expect.any(String));
    expect(vi.mocked(createCard).mock.calls[0][1].trim()).toBe("생활비 카드");
  });

  it("maps a duplicate label to 409", async () => {
    vi.mocked(createCard).mockResolvedValue({ kind: "duplicate_label" });
    const response = await POST(cardRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "DUPLICATE_LABEL" } });
  });

  it("lets the store reject empty labels as INVALID_LABEL", async () => {
    vi.mocked(createCard).mockResolvedValue({ kind: "invalid_label" });
    const response = await POST(cardRequest({ body: JSON.stringify({ label: "" }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_LABEL" } });
    expect(createCard).toHaveBeenCalledExactlyOnceWith(userId, "");
  });

  it.each(["{", "null", "[]", "{}", '{"label":123}'])("rejects invalid JSON input %s", async (body) => {
    const response = await POST(cardRequest({ body }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST" } });
    expect(createCard).not.toHaveBeenCalled();
  });

  it("returns 503 without a store error message", async () => {
    vi.mocked(createCard).mockRejectedValue(new Error("PRIVATE_CARD_ERROR"));
    const response = await POST(cardRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
  });

  it("returns 503 when session lookup throws", async () => {
    vi.mocked(getSessionUser).mockRejectedValue(new Error("PRIVATE_AUTH_ERROR"));
    const response = await POST(cardRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "TEMPORARY_FAILURE" } });
    expect(createCard).not.toHaveBeenCalled();
  });
});
