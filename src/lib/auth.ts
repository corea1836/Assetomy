import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LoginErrorCode, SessionUser } from "@/types/auth";

export const DEFAULT_NEXT_PATH = "/dashboard";

export function safeNextPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return DEFAULT_NEXT_PATH;
  }

  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return DEFAULT_NEXT_PATH;
  }

  const path = value.split(/[?#]/, 1)[0];
  if (
    path === "/login" ||
    path.startsWith("/login/") ||
    path.startsWith("/auth/")
  ) {
    return DEFAULT_NEXT_PATH;
  }

  return value;
}

export function loginPath(next: string, error?: LoginErrorCode): string {
  const path = `/login?next=${encodeURIComponent(next)}`;
  return error ? `${path}&error=${error}` : path;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;

  if (error || typeof sub !== "string") return null;

  return { id: sub };
}

export async function requireUser(nextPath: string): Promise<SessionUser> {
  const user = await getSessionUser();

  if (!user) redirect(loginPath(safeNextPath(nextPath)));

  return user;
}
