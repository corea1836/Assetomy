import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, checkMutationRequest, clientIp } from "./http";

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

describe("clientIp", () => {
  it("uses only the first forwarded IP and trims whitespace", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 203.0.113.5 , 10.0.0.1 " }))).toBe("203.0.113.5");
  });

  it("uses x-real-ip when x-forwarded-for is absent", () => {
    expect(clientIp(new Headers({ "x-real-ip": " 198.51.100.9 " }))).toBe("198.51.100.9");
  });

  it("prefers x-forwarded-for over x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5", "x-real-ip": "198.51.100.9" })))
      .toBe("203.0.113.5");
  });

  it.each(["", "not-an-ip", "10.0.0.1", "not-an-ip, 203.0.113.5"])(
    "does not fall back to another IP for invalid or private first value %s", (value) => {
      expect(clientIp(new Headers({ "x-forwarded-for": value, "x-real-ip": "198.51.100.9" }))).toBeNull();
    },
  );

  it.each([
    "::1", "127.0.0.1", "127.255.255.255", "10.1.2.3", "10.255.255.255",
    "192.168.0.1", "192.168.255.255", "172.16.0.1", "172.20.0.1", "172.31.255.255",
    "169.254.0.1", "169.254.255.255", "fc00::1", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fe80::1", "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.1.2.3", "::ffff:172.20.0.1",
    "::ffff:192.168.0.1", "::ffff:169.254.0.1",
  ])("excludes local or private IP %s", (value) => {
    expect(clientIp(new Headers({ "x-forwarded-for": value }))).toBeNull();
    expect(clientIp(new Headers({ "x-real-ip": value }))).toBeNull();
  });

  it.each(["203.0.113.5", "2001:db8::1", "::ffff:203.0.113.5", "172.15.255.255", "172.32.0.1"])(
    "preserves public IP %s", (value) => {
      expect(clientIp(new Headers({ "x-forwarded-for": value }))).toBe(value);
    },
  );

  it.each(["not-an-ip", "203.0.113.5:443", "[2001:db8::1]"])("rejects invalid IP %s", (value) => {
    expect(clientIp(new Headers({ "x-real-ip": value }))).toBeNull();
  });

  it("returns null without either header", () => {
    expect(clientIp(new Headers())).toBeNull();
  });
});
