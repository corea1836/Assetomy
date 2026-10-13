import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { apiError, checkMutationRequest } from "@/lib/http";
import { recordMetric } from "@/lib/store/metrics";
import { UPGRADE_SOURCES } from "@/types/billing";

const inputSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("teaser_seen") }),
  z.object({ event: z.literal("upgrade_click"), source: z.enum(UPGRADE_SOURCES) }),
]);

export async function POST(request: Request): Promise<Response> {
  let userId = "-";
  try {
    const user = await getSessionUser();
    if (!user) return apiError(401, "UNAUTHORIZED");
    userId = user.id;
    const invalidRequest = checkMutationRequest(request, "application/json");
    if (invalidRequest) return invalidRequest;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError(400, "BAD_REQUEST");
    }
    const input = inputSchema.safeParse(body);
    if (!input.success) return apiError(400, "BAD_REQUEST");

    const result = await recordMetric(user.id, input.data);
    switch (result.kind) {
      case "recorded":
      case "unchanged":
        return new Response(null, { status: 204 });
      case "user_not_found":
        return apiError(401, "UNAUTHORIZED");
    }
  } catch (error) {
    console.error(`metrics:${error instanceof Error ? error.constructor.name : "unknown"}`, userId);
    return apiError(503, "TEMPORARY_FAILURE");
  }
}
