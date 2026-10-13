import "server-only";
import { webhooks } from "@polar-sh/sdk/2026-10";
import { z } from "zod";

export type PolarWebhookResult =
  | { kind: "state_changed"; externalCustomerId: string | null }
  | { kind: "ignored" }
  | { kind: "invalid_signature" }
  | { kind: "invalid_payload" };

const stateChangedSchema = z.object({
  data: z.object({ external_id: z.string().nullable().optional() }),
});

export async function parsePolarWebhook(body: string, headers: Headers, secret: string): Promise<PolarWebhookResult> {
  try {
    const event = await webhooks.validateEvent(body, {
      "webhook-id": headers.get("webhook-id") ?? "",
      "webhook-timestamp": headers.get("webhook-timestamp") ?? "",
      "webhook-signature": headers.get("webhook-signature") ?? "",
    }, secret);
    if (event.type !== "customer.state_changed") return { kind: "ignored" };
    const parsed = stateChangedSchema.safeParse(event);
    if (!parsed.success) return { kind: "invalid_payload" };
    return { kind: "state_changed", externalCustomerId: parsed.data.data.external_id ?? null };
  } catch (error) {
    if (error instanceof webhooks.PolarWebhookVerificationError) return { kind: "invalid_signature" };
    if (error instanceof webhooks.PolarWebhookUnknownTypeError) return { kind: "ignored" };
    if (error instanceof webhooks.PolarWebhookError) return { kind: "invalid_payload" };
    throw error;
  }
}
