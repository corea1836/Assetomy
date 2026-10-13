import type { Plan } from "./dashboard";
import type { IsoDate } from "./transaction";

export const UPGRADE_SOURCES = ["teaser", "trend", "summary", "pricing", "settings"] as const;
export type UpgradeSource = (typeof UPGRADE_SOURCES)[number];

export type StoredSubscription = {
  plan: Plan;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type SaveSubscriptionInput = {
  userId: string;
  syncedFrom: string;
  plan: Plan;
  subscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type SaveSubscriptionResult =
  | { kind: "saved" | "stale"; subscription: StoredSubscription }
  | { kind: "user_not_found" };

export type PlanState =
  | { plan: "free" }
  | { plan: "pro"; periodEnd: IsoDate | null; cancelAtPeriodEnd: boolean };
