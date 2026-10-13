import { z } from "zod";
import { defaultBillingDeps } from "@/lib/billing/deps";
import { syncFromPolar } from "@/lib/billing/sync";
import { getPolarWebhookSecret } from "@/lib/env";
import { apiError } from "@/lib/http";
import { getMode } from "@/lib/mode";
import { parsePolarWebhook, type PolarWebhookResult } from "@/services/polar/webhook";

const idSchema = z.uuid();

export async function POST(request: Request): Promise<Response> {
  if (getMode() === "mock") return apiError(404, "NOT_FOUND");

  let secret: string;
  try {
    secret = getPolarWebhookSecret();
  } catch {
    console.error("billing:webhook:secret_missing");
    return apiError(500, "TEMPORARY_FAILURE");
  }

  let event: PolarWebhookResult;
  try {
    event = await parsePolarWebhook(await request.text(), request.headers, secret);
  } catch {
    console.error("billing:webhook:parse_failed", "-");
    return apiError(500, "TEMPORARY_FAILURE");
  }

  switch (event.kind) {
    case "invalid_signature":
      console.error("billing:webhook:invalid_signature", "-");
      return apiError(403, "FORBIDDEN");
    case "invalid_payload":
      console.error("billing:webhook:invalid_payload", "-");
      return apiError(400, "BAD_REQUEST");
    case "ignored":
      return Response.json({ received: true });
  }

  const id = idSchema.safeParse(event.externalCustomerId);
  if (!id.success) return Response.json({ received: true });

  try {
    const result = await syncFromPolar(id.data, defaultBillingDeps());
    if (result.kind !== "failed") return Response.json({ received: true });
  } catch {
    // Dependency failures also need Polar to retry the synchronization.
  }
  console.error("billing:webhook:failed", id.data);
  return apiError(503, "TEMPORARY_FAILURE");
}
