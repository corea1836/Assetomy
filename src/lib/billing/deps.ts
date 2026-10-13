import "server-only";
import { getMode, type Mode } from "@/lib/mode";
import { getSiteOrigin } from "@/lib/origin";
import { saveSubscription } from "@/lib/store/subscriptions";
import { getPolarGateway } from "@/services/polar";
import type { PolarGateway } from "@/services/polar/types";
import type { SaveSubscriptionInput, SaveSubscriptionResult } from "@/types/billing";

export type BillingDeps = {
  mode: Mode;
  now: () => Date;
  origin: string;
  gateway: () => PolarGateway;
  saveSubscription: (input: SaveSubscriptionInput) => Promise<SaveSubscriptionResult>;
};

export function defaultBillingDeps(): BillingDeps {
  return {
    mode: getMode(), now: () => new Date(), origin: getSiteOrigin(), gateway: getPolarGateway, saveSubscription,
  };
}
