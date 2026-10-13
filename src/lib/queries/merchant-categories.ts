import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { CATEGORY_IDS, type CategoryId } from "@/types/category";
import { readQuery } from "./query-error";

const KEY_BATCH_SIZE = 100;
const PAGE_SIZE = 1000;
const categoriesResponseSchema = z.object({
  data: z.array(z.object({ merchant_key: z.string().min(1).max(200), category: z.enum(CATEGORY_IDS) })),
});

export async function findMerchantCategories(
  supabase: SupabaseClient, userId: string, merchantKeys: string[],
): Promise<Map<string, CategoryId>> {
  const categories = new Map<string, CategoryId>();
  const keys = [...new Set(merchantKeys)];

  async function readCategories(table: "merchant_category_overrides" | "transactions", chunk: string[]) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data } = await readQuery("findMerchantCategories", () => {
        let query = supabase.from(table).select("merchant_key, category")
          .eq("user_id", userId).in("merchant_key", chunk);
        query = table === "transactions"
          ? query.order("created_at", { ascending: false }).order("id", { ascending: false })
          : query.order("merchant_key", { ascending: true });
        return query.range(offset, offset + PAGE_SIZE - 1);
      }, categoriesResponseSchema);
      for (const row of data) {
        if (!categories.has(row.merchant_key)) categories.set(row.merchant_key, row.category);
      }
      if (data.length < PAGE_SIZE) return;
    }
  }

  for (let offset = 0; offset < keys.length; offset += KEY_BATCH_SIZE) {
    const chunk = keys.slice(offset, offset + KEY_BATCH_SIZE);
    await readCategories("merchant_category_overrides", chunk);
    const missing = chunk.filter((key) => !categories.has(key));
    if (missing.length) await readCategories("transactions", missing);
  }
  return categories;
}
