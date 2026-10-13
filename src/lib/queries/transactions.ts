import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { CATEGORY_IDS } from "@/types/category";
import type { Transaction } from "@/types/transaction";
import type { TransactionCoverage } from "@/types/upload";
import { QueryError, readQuery } from "./query-error";

const PAGE_SIZE = 1000;
const transactionsResponseSchema = z.object({
  data: z.array(z.object({
    id: z.uuid(), card_id: z.uuid(), used_on: z.iso.date(),
    merchant: z.string().min(1).max(200), merchant_key: z.string().min(1).max(200),
    amount: z.int(), category: z.enum(CATEGORY_IDS),
  })),
});

export async function listTransactions(
  supabase: SupabaseClient, userId: string, cardLabels: ReadonlyMap<string, string>,
): Promise<Transaction[]> {
  const transactions: Transaction[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data } = await readQuery("listTransactions", () => supabase.from("transactions")
      .select("id, card_id, used_on, merchant, merchant_key, amount, category").eq("user_id", userId)
      .order("used_on", { ascending: true }).order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1), transactionsResponseSchema);
    for (const row of data) {
      const cardLabel = cardLabels.get(row.card_id);
      if (cardLabel === undefined) throw new QueryError("listTransactions", "unknown_card");
      transactions.push({
        id: row.id, cardId: row.card_id, cardLabel, date: row.used_on,
        merchant: row.merchant, merchantKey: row.merchant_key, amount: row.amount, category: row.category,
      });
    }
    if (data.length < PAGE_SIZE) return transactions;
  }
}

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
