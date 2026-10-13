import "server-only";
import { getPolarEnv } from "@/lib/env";
import { getMode, type Mode } from "@/lib/mode";
import { getSiteOrigin } from "@/lib/origin";
import { saveSubscription } from "@/lib/store/subscriptions";
import { recordMetric } from "@/lib/store/metrics";
import { getPolarGateway } from "@/services/polar";
import type { PolarGateway } from "@/services/polar/types";
import type { SaveSubscriptionInput, SaveSubscriptionResult } from "@/types/billing";
import type { RecordMetricResult, StoreMetric } from "@/types/metrics";

export type BillingDeps = {
  mode: Mode;
  now: () => Date;
  origin: string;
  gateway: () => PolarGateway;
  saveSubscription: (input: SaveSubscriptionInput) => Promise<SaveSubscriptionResult>;
  isProductionBilling: () => boolean;
  recordMetric: (userId: string, metric: StoreMetric) => Promise<RecordMetricResult>;
};

export function defaultBillingDeps(): BillingDeps {
  return {
    mode: getMode(), now: () => new Date(), origin: getSiteOrigin(), gateway: getPolarGateway, saveSubscription,
    isProductionBilling: () => getMode() === "live" && getPolarEnv().server === "production", recordMetric,
  };
}
