import "server-only";
import { errors, type createPolar } from "@polar-sh/sdk/2026-10";
import { z } from "zod";
import { PolarGatewayError, type PolarGateway } from "./types";

type Client = ReturnType<typeof createPolar>;
export type PolarClient = {
  customers: Pick<Client["customers"], "getStateExternal">;
  checkouts: Pick<Client["checkouts"], "create">;
  customerSessions: Pick<Client["customerSessions"], "create">;
};

// The SDK returns parsed JSON without runtime validation. Validate the fields we use.
const customerStateSchema = z.object({
  active_subscriptions: z.array(z.object({
    id: z.string().min(1).max(100),
    product_id: z.string().min(1),
    status: z.string().min(1),
    current_period_end: z.iso.datetime({ offset: true }),
    cancel_at_period_end: z.boolean(),
  })),
});
const httpUrlSchema = z.url({ protocol: /^https?$/ });
const checkoutSchema = z.object({ url: httpUrlSchema });
const portalSchema = z.object({ customer_portal_url: httpUrlSchema });

function statusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return;
  const code = error.statusCode;
  if (typeof code === "number" && Number.isInteger(code) && code >= 100 && code <= 599) return code;
}

function isNotFound(error: unknown): boolean {
  return error instanceof errors.ResourceNotFound || statusCode(error) === 404;
}

function gatewayError(operation: PolarGatewayError["operation"], error: unknown): PolarGatewayError {
  if (error instanceof PolarGatewayError) return error;
  const status = statusCode(error);
  const code = status !== undefined ? String(status) : error instanceof SyntaxError ? "unexpected_response" : "network";
  return new PolarGatewayError(operation, code);
}

export function createPolarGateway(polar: PolarClient, proProductId: string): PolarGateway {
  return {
    async getCustomerState(userId) {
      try {
        const response = await polar.customers.getStateExternal(userId);
        const parsed = customerStateSchema.safeParse(response);
        if (!parsed.success) throw new PolarGatewayError("get_state", "unexpected_response");

        let latest: (typeof parsed.data.active_subscriptions)[number] | undefined;
        for (const subscription of parsed.data.active_subscriptions) {
          if (subscription.product_id !== proProductId || subscription.status !== "active") continue;
          if (!latest || Date.parse(subscription.current_period_end) > Date.parse(latest.current_period_end)) {
            latest = subscription;
          }
        }
        return {
          kind: "customer",
          pro: latest ? {
            subscriptionId: latest.id,
            currentPeriodEnd: latest.current_period_end,
            cancelAtPeriodEnd: latest.cancel_at_period_end,
          } : null,
        };
      } catch (error) {
        if (isNotFound(error)) return { kind: "no_customer" };
        throw gatewayError("get_state", error);
      }
    },

    async createCheckoutUrl(input) {
      try {
        const response = await polar.checkouts.create({
          products: [proProductId],
          external_customer_id: input.userId,
          ...(input.customerIp !== null ? { customer_ip_address: input.customerIp } : {}),
          success_url: input.successUrl,
          return_url: input.returnUrl,
          metadata: { source: input.source },
        });
        const parsed = checkoutSchema.safeParse(response);
        if (!parsed.success) throw new PolarGatewayError("checkout", "unexpected_response");
        return parsed.data.url;
      } catch (error) {
        throw gatewayError("checkout", error);
      }
    },

    async createPortalUrl(input) {
      try {
        const response = await polar.customerSessions.create({
          external_customer_id: input.userId,
          return_url: input.returnUrl,
        });
        const parsed = portalSchema.safeParse(response);
        if (!parsed.success) throw new PolarGatewayError("portal", "unexpected_response");
        return parsed.data.customer_portal_url;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw gatewayError("portal", error);
      }
    },
  };
}
