import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMetric } from "./send-metric";
import type { MetricRequest } from "@/types/metrics";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("sendMetric", () => {
  it.each([
    { event: "teaser_seen" },
    { event: "upgrade_click", source: "summary" },
  ] satisfies MetricRequest[])("sends $event as keepalive JSON without waiting", (metric) => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    expect(sendMetric(metric)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/metrics", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metric), keepalive: true,
    });
  });

  it("swallows a synchronous fetch exception", () => {
    fetchMock.mockImplementation(() => { throw new Error("unavailable"); });
    expect(() => sendMetric({ event: "teaser_seen" })).not.toThrow();
  });

  it("swallows asynchronous failure without retrying", async () => {
    fetchMock.mockRejectedValue(new Error("unavailable"));
    expect(() => sendMetric({ event: "teaser_seen" })).not.toThrow();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("ignores an error response without reading its body", async () => {
    const response = Response.json({ error: { code: "TEMPORARY_FAILURE" } }, { status: 503 });
    const read = vi.spyOn(response, "json");
    fetchMock.mockResolvedValue(response);
    sendMetric({ event: "teaser_seen" });
    await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
