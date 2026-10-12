import "server-only";
import { z } from "zod";

export type DeploymentEnv = {
  vercelEnv: "production" | "preview" | "development" | undefined;
  vercelUrl: string | undefined;
  siteUrl: string | undefined;
  appMode: "mock" | "live" | undefined;
};

export type SupabaseEnv = {
  url: string;
  publishableKey: string;
};

const emptyAsUndefined = (value: unknown) => (value === "" ? undefined : value);

const deploymentEnvSchema = z.object({
  VERCEL_ENV: z.preprocess(
    emptyAsUndefined,
    z.enum(["production", "preview", "development"]).optional(),
  ),
  VERCEL_URL: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .refine((host) => {
        try {
          return new URL(`https://${host}`).host === host;
        } catch {
          return false;
        }
      })
      .optional(),
  ),
  NEXT_PUBLIC_SITE_URL: z.preprocess(emptyAsUndefined, z.url().optional()),
  APP_MODE: z.preprocess(emptyAsUndefined, z.enum(["mock", "live"]).optional()),
});

const supabaseEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.preprocess(
    emptyAsUndefined,
    z.url({ protocol: /^https?$/ }),
  ),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.preprocess(
    emptyAsUndefined,
    z.string().min(1),
  ),
});

const fileEncryptionKeySchema = z.string().min(1).transform((value, ctx) => {
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== value) {
    ctx.addIssue({ code: "custom" });
    return z.NEVER;
  }
  return new Uint8Array(key);
});

export function getFileEncryptionKey(): Uint8Array {
  const result = fileEncryptionKeySchema.safeParse(process.env.FILE_ENCRYPTION_KEY);
  if (!result.success) {
    throw new Error("FILE_ENCRYPTION_KEY");
  }
  return result.data;
}

export function getDeploymentEnv(): DeploymentEnv {
  const result = deploymentEnvSchema.safeParse({
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_URL: process.env.VERCEL_URL,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    APP_MODE: process.env.APP_MODE,
  });

  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.path[0]).join(", "));
  }

  return {
    vercelEnv: result.data.VERCEL_ENV,
    vercelUrl: result.data.VERCEL_URL,
    siteUrl: result.data.NEXT_PUBLIC_SITE_URL,
    appMode: result.data.APP_MODE,
  };
}

export function getSupabaseEnv(): SupabaseEnv {
  const result = supabaseEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.path[0]).join(", "));
  }

  return {
    url: result.data.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: result.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}
