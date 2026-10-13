import "server-only";
import { createPolar } from "@polar-sh/sdk/2026-10";
import { getPolarEnv } from "@/lib/env";
import { getMode } from "@/lib/mode";
import { createPolarGateway } from "./polar-gateway";
import type { PolarGateway } from "./types";

export function getPolarGateway(): PolarGateway {
  if (getMode() === "mock") throw new Error("polar:mock_mode");
  const { accessToken, server, proProductId } = getPolarEnv();
  const client = createPolar({ accessToken, environment: server, timeout: 10 });
  return createPolarGateway(client, proProductId);
}
