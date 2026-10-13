import type { MetricRequest } from "@/types/metrics";

export function sendMetric(metric: MetricRequest): void {
  try {
    void fetch("/api/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metric),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // 측정 실패는 사용자 행동을 막지 않는다.
  }
}
