import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { TransactionCoverage } from "@/types/upload";
import { readQuery } from "./query-error";

const countResponseSchema = z.object({ count: z.int().nonnegative() });
const boundaryResponseSchema = z.object({ data: z.array(z.object({ used_on: z.iso.date() })).length(1) });

export async function getTransactionCoverage(
  supabase: SupabaseClient, userId: string,
): Promise<TransactionCoverage> {
  const { count } = await readQuery("getTransactionCoverage", () => supabase.from("transactions")
    .select("id", { count: "exact", head: true }).eq("user_id", userId), countResponseSchema);
  if (count === 0) return { count: 0, from: null, to: null };

  const [first, last] = await Promise.all([true, false].map((ascending) =>
    readQuery("getTransactionCoverage", () => supabase.from("transactions")
      .select("used_on").eq("user_id", userId).order("used_on", { ascending }).limit(1), boundaryResponseSchema),
  ));
  return { count, from: first.data[0].used_on, to: last.data[0].used_on };
}
