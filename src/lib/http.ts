import "server-only";
import { BlockList, isIP } from "node:net";
import { isAllowedOrigin } from "@/lib/origin";
import type { ApiErrorBody, ApiErrorCode } from "@/types/upload";

const localIps = new BlockList();
localIps.addSubnet("127.0.0.0", 8, "ipv4");
localIps.addSubnet("10.0.0.0", 8, "ipv4");
localIps.addSubnet("172.16.0.0", 12, "ipv4");
localIps.addSubnet("192.168.0.0", 16, "ipv4");
localIps.addSubnet("169.254.0.0", 16, "ipv4");
localIps.addAddress("::1", "ipv6");
localIps.addSubnet("fc00::", 7, "ipv6");
localIps.addSubnet("fe80::", 10, "ipv6");

export function clientIp(headers: Headers): string | null {
  const ip = (headers.get("x-forwarded-for")?.split(",", 1)[0] ?? headers.get("x-real-ip"))?.trim();
  if (!ip) return null;
  const family = isIP(ip);
  if (family === 0 || localIps.check(ip, family === 4 ? "ipv4" : "ipv6")) return null;
  return ip;
}

export function apiError(status: number, code: ApiErrorCode, reason?: string): Response {
  const body: ApiErrorBody = { error: { code, ...(reason === undefined ? {} : { reason }) } };
  return Response.json(body, { status });
}

export function checkMutationRequest(
  request: Request, mediaType: "application/json" | "multipart/form-data" | null,
): Response | null {
  if (!isAllowedOrigin(request.headers.get("origin"))) return apiError(403, "FORBIDDEN");
  if (mediaType !== null) {
    const actual = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (actual !== mediaType) return apiError(400, "BAD_REQUEST");
  }
  return null;
}
