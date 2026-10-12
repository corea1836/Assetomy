import { NextResponse } from "next/server";
import { loginPath, safeNextPath } from "@/lib/auth";
import { getSiteOrigin, isAllowedOrigin } from "@/lib/origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<Response> {
  if (!isAllowedOrigin(request.headers.get("origin"))) {
    return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  }

  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded") {
    return NextResponse.json({ error: { code: "BAD_REQUEST" } }, { status: 400 });
  }

  const next = safeNextPath((await request.formData()).get("next"));
  const origin = getSiteOrigin();
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });

  if (error || !data.url) {
    return NextResponse.redirect(origin + loginPath(next, "failed"), 303);
  }

  return NextResponse.redirect(data.url, 303);
}
