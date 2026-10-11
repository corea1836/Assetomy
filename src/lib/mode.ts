import { getDeploymentEnv } from "./env";

export type Mode = "mock" | "live";

export function getMode(): Mode {
  const { vercelEnv, appMode } = getDeploymentEnv();

  if (vercelEnv === "production") return "live";
  if (vercelEnv === "preview") return "mock";
  return appMode ?? "mock";
}
