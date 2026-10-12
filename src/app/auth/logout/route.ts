import { NextResponse } from "next/server";
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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });

  return NextResponse.redirect(getSiteOrigin() + (error ? "/dashboard" : "/"), 303);
}
