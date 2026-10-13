import { getSessionUser } from "@/lib/auth";
import { defaultBillingDeps } from "@/lib/billing/deps";
import { openPortal } from "@/lib/billing/portal";
import { apiError, checkMutationRequest } from "@/lib/http";
import type { BillingUrlResponse } from "@/types/billing";

export async function POST(request: Request): Promise<Response> {
  let userId = "-";
  try {
    const user = await getSessionUser();
    if (!user) return apiError(401, "UNAUTHORIZED");
    userId = user.id;
    const invalidRequest = checkMutationRequest(request, "application/json");
    if (invalidRequest) return invalidRequest;

    const url = await openPortal(user.id, defaultBillingDeps());
    if (url === null) return apiError(404, "NOT_FOUND");
    return Response.json({ url } satisfies BillingUrlResponse);
  } catch (error) {
    console.error(`billing:portal:${error instanceof Error ? error.constructor.name : "unknown"}`, userId);
    return apiError(503, "TEMPORARY_FAILURE");
  }
}
