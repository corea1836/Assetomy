import type { UpgradeSource } from "./billing";

export type MetricRequest =
  | { event: "teaser_seen" }
  | { event: "upgrade_click"; source: UpgradeSource };

export type StoreMetric = MetricRequest | { event: "first_paid" };
export type RecordMetricResult = { kind: "recorded" | "unchanged" | "user_not_found" };
