import { getDeploymentEnv } from "./env";

export function getSiteOrigin(): string {
  const { vercelEnv, vercelUrl, siteUrl } = getDeploymentEnv();

  if (vercelEnv === "production") {
    if (!siteUrl) throw new Error("NEXT_PUBLIC_SITE_URL");

    const url = new URL(siteUrl);
    if (url.protocol !== "https:") throw new Error("NEXT_PUBLIC_SITE_URL");
    return url.origin;
  }

  if (vercelEnv === "preview") {
    if (!vercelUrl) throw new Error("VERCEL_URL");
    return new URL(`https://${vercelUrl}`).origin;
  }

  return new URL(siteUrl ?? "http://localhost:3000").origin;
}

export function isAllowedOrigin(origin: string | null): boolean {
  return origin !== null && origin !== "null" && origin === getSiteOrigin();
}
