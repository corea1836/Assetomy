import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { StatementRecord } from "@/types/card";
import { seoulToday } from "@/lib/clock";
import { readQuery } from "./query-error";

const PAGE_SIZE = 1000;
const statementsResponseSchema = z.object({
  data: z.array(z.object({
    card_id: z.uuid(),
    statement_date: z.iso.date(),
    statement_saved_at: z.iso.datetime({ offset: true }).nullable(),
    created_at: z.iso.datetime({ offset: true }),
  })),
});

export async function listStatements(supabase: SupabaseClient, userId: string): Promise<StatementRecord[]> {
  const statements: StatementRecord[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data } = await readQuery("listStatements", () => supabase.from("uploads")
      .select("card_id, statement_date, statement_saved_at, created_at")
      .eq("user_id", userId).eq("status", "done").not("statement_date", "is", null)
      .order("statement_date", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1), statementsResponseSchema);
    for (const row of data) {
      const createdAt = Date.parse(row.created_at);
      const savedAt = row.statement_saved_at === null ? createdAt : Math.min(Date.parse(row.statement_saved_at), createdAt);
      statements.push({
        cardId: row.card_id,
        statementDate: row.statement_date,
        savedOn: seoulToday(new Date(savedAt)),
      });
    }
    if (data.length < PAGE_SIZE) return statements;
  }
}
