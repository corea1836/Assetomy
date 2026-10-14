import type { FlowDirection } from "@/types/dashboard";

export const FLOW_STEADY_RATIO = 0.1;
export const FLOW_CATEGORY_LIMIT = 5;

export function flowDirection(values: readonly number[]): FlowDirection {
  if (values.length < 2) {
    throw new Error("A flow requires at least two values");
  }

  const steps = values.slice(1).map((value, index): FlowDirection => {
    const previous = values[index];
    const difference = Math.abs(value - previous);
    const steadyLimit = FLOW_STEADY_RATIO * Math.max(Math.abs(previous), Math.abs(value));
    if (difference <= steadyLimit) return "steady";
    return value > previous ? "rising" : "falling";
  });
  const first = steps[0];
  return steps.every((step) => step === first) ? first : "mixed";
}
