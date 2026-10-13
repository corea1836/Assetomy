import "server-only";
import { z } from "zod";
import type { RecordMetricResult, StoreMetric } from "@/types/metrics";
import { callStoreRpc } from "./store-error";

const recordMetricResultSchema = z.object({ kind: z.enum(["recorded", "unchanged", "user_not_found"]) });

export async function recordMetric(userId: string, metric: StoreMetric): Promise<RecordMetricResult> {
  return callStoreRpc("record_metric", {
    p_user_id: userId, p_event: metric.event, p_source: metric.event === "upgrade_click" ? metric.source : null,
  }, recordMetricResultSchema);
}
