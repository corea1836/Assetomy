import { PolarGatewayError, type PolarCustomerState, type PolarGateway } from "./types";

type Method = "getCustomerState" | "createCheckoutUrl" | "createPortalUrl";
type FakePolarGateway = PolarGateway & {
  calls: { method: Method; input: unknown }[];
  setState(userId: string, state: PolarCustomerState): void;
  failNext(method: Method): void;
};

export function createFakePolarGateway(initial: Record<string, PolarCustomerState> = {}): FakePolarGateway {
  const states = new Map(Object.entries(initial));
  const failures = new Set<Method>();
  const calls: FakePolarGateway["calls"] = [];
  const operations: Record<Method, PolarGatewayError["operation"]> = {
    getCustomerState: "get_state", createCheckoutUrl: "checkout", createPortalUrl: "portal",
  };

  function record(method: Method, input: unknown): void {
    calls.push({ method, input });
    if (failures.delete(method)) throw new PolarGatewayError(operations[method], "network");
  }

  return {
    calls,
    setState(userId, state) { states.set(userId, state); },
    failNext(method) { failures.add(method); },
    async getCustomerState(userId) {
      record("getCustomerState", userId);
      return states.get(userId) ?? { kind: "no_customer" };
    },
    async createCheckoutUrl(input) {
      record("createCheckoutUrl", input);
      return `https://polar.test/checkout/${input.userId}`;
    },
    async createPortalUrl(input) {
      record("createPortalUrl", input);
      if (states.get(input.userId)?.kind !== "customer") return null;
      return `https://polar.test/portal/${input.userId}`;
    },
  };
}
