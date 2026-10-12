import { NextResponse } from "next/server";
import { loginPath, safeNextPath } from "@/lib/auth";
import { getSiteOrigin } from "@/lib/origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const next = safeNextPath(searchParams.get("next"));
  const origin = getSiteOrigin();

  if (error !== null) {
    const errorCode = error === "access_denied" ? "cancelled" : "failed";
    return NextResponse.redirect(origin + loginPath(next, errorCode), 302);
  }

  if (!code) {
    return NextResponse.redirect(origin + loginPath(next, "failed"), 302);
  }

  const supabase = await createSupabaseServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(origin + loginPath(next, "failed"), 302);
  }

  return NextResponse.redirect(origin + next, 302);
}
