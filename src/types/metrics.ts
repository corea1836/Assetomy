import type { UpgradeSource } from "./billing";

export type MetricRequest =
  | { event: "teaser_seen" }
  | { event: "upgrade_click"; source: UpgradeSource };
