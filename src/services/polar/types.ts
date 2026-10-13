import "server-only";
import type { UpgradeSource } from "@/types/billing";

export type ProSubscription = {
  subscriptionId: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
};

export type PolarCustomerState =
  | { kind: "no_customer" }
  | { kind: "customer"; pro: ProSubscription | null };

export type CheckoutInput = {
  userId: string;
  customerIp: string | null;
  successUrl: string;
  returnUrl: string;
  source: UpgradeSource;
};

export interface PolarGateway {
  getCustomerState(userId: string): Promise<PolarCustomerState>;
  createCheckoutUrl(input: CheckoutInput): Promise<string>;
  createPortalUrl(input: { userId: string; returnUrl: string }): Promise<string | null>;
}

export class PolarGatewayError extends Error {
  constructor(
    readonly operation: "get_state" | "checkout" | "portal",
    readonly code: string,
  ) {
    super(`polar:${operation}:${code}`);
    this.name = "PolarGatewayError";
  }
}
