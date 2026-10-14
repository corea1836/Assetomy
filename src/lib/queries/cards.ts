import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ANALYSIS_BASES, CARD_ISSUERS } from "@/types/card";
import type { CardOption } from "@/types/upload";
import { readQuery } from "./query-error";

const PAGE_SIZE = 1000;
const cardsResponseSchema = z.object({
  data: z.array(z.object({
    id: z.uuid(),
    label: z.string().trim().min(1).max(30),
    issuer: z.enum(CARD_ISSUERS),
    analysis_basis: z.enum(ANALYSIS_BASES),
    cycle_start_day: z.int().min(1).max(31).nullable(),
  }).transform((card): CardOption => ({
    id: card.id,
    label: card.label,
    issuer: card.issuer,
    analysisBasis: card.analysis_basis,
    cycleStartDay: card.cycle_start_day,
  }))),
});

export async function listCards(supabase: SupabaseClient, userId: string): Promise<CardOption[]> {
  const cards: CardOption[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data } = await readQuery("listCards", () => supabase.from("cards")
      .select("id, label, issuer, analysis_basis, cycle_start_day").eq("user_id", userId)
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1), cardsResponseSchema);
    cards.push(...data);
    if (data.length < PAGE_SIZE) return cards;
  }
}
