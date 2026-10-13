import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { startCheckout } from "@/lib/billing/checkout";
import { defaultBillingDeps } from "@/lib/billing/deps";
import { apiError, checkMutationRequest, clientIp } from "@/lib/http";
import { getSubscription } from "@/lib/queries/subscriptions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UPGRADE_SOURCES, type BillingUrlResponse } from "@/types/billing";

const inputSchema = z.object({ source: z.enum(UPGRADE_SOURCES) });

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

    const stored = await getSubscription(await createSupabaseServerClient(), user.id);
    const url = await startCheckout({
      userId: user.id, source: input.data.source, customerIp: clientIp(request.headers), stored,
    }, defaultBillingDeps());
    return Response.json({ url } satisfies BillingUrlResponse);
  } catch (error) {
    console.error(`billing:checkout:${error instanceof Error ? error.constructor.name : "unknown"}`, userId);
    return apiError(503, "TEMPORARY_FAILURE");
  }
}
