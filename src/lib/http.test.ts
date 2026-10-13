import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, checkMutationRequest } from "./http";

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
});
afterEach(() => vi.unstubAllEnvs());

function request(origin: string | null, contentType?: string): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  if (contentType !== undefined) headers.set("content-type", contentType);
  return new Request("http://localhost:3000/api/cards", { method: "POST", headers });
}

describe("checkMutationRequest", () => {
  it.each([null, "null", "https://evil.example", "http://localhost:3000/"])(
    "rejects the Origin %s before checking the content type", async (origin) => {
      const response = checkMutationRequest(request(origin, "text/plain"), "application/json");
      expect(response?.status).toBe(403);
      expect(await response?.json()).toEqual({ error: { code: "FORBIDDEN" } });
    },
  );

  it.each(["application/json; charset=utf-8", "Application/JSON; charset=UTF-8"])(
    "accepts the JSON media type %s", (contentType) => {
      expect(checkMutationRequest(request("http://localhost:3000", contentType), "application/json"))
        .toBeNull();
    },
  );

  it("accepts multipart media types with boundary parameters", () => {
    expect(checkMutationRequest(
      request("http://localhost:3000", "multipart/form-data; boundary=example"), "multipart/form-data",
    )).toBeNull();
  });

  it.each(["text/plain", "application/jsonp", undefined])("rejects the content type %s", async (contentType) => {
    const response = checkMutationRequest(request("http://localhost:3000", contentType), "application/json");
    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({ error: { code: "BAD_REQUEST" } });
  });

  it("ignores the content type for requests without a body", () => {
    expect(checkMutationRequest(request("http://localhost:3000", "text/plain"), null)).toBeNull();
    expect(checkMutationRequest(request("http://localhost:3000"), null)).toBeNull();
    expect(checkMutationRequest(request(null), null)?.status).toBe(403);
  });
});

describe("apiError", () => {
  it("returns the status and JSON code without an absent reason", async () => {
    const response = apiError(401, "UNAUTHORIZED");
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("includes a supplied reason", async () => {
    expect(await apiError(422, "UNSUPPORTED_FILE", "not_pdf").json())
      .toEqual({ error: { code: "UNSUPPORTED_FILE", reason: "not_pdf" } });
  });
});
