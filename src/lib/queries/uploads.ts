import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { DoneUpload, UploadOutcomeRecord } from "@/types/upload";
import { readQuery } from "./query-error";

const uploadResponseSchema = z.object({
  data: z.discriminatedUnion("status", [
    z.object({
      id: z.uuid(), status: z.enum(["done", "no_new"]),
      inserted_count: z.int().nonnegative(), duplicate_count: z.int().nonnegative(), skipped_count: z.int().nonnegative(),
      period_from: z.iso.date().nullable(), period_to: z.iso.date().nullable(), net_amount: z.int(),
    }).transform((row) => ({
      status: row.status, inserted: row.inserted_count, duplicates: row.duplicate_count, skipped: row.skipped_count,
      periodFrom: row.period_from, periodTo: row.period_to, netAmount: row.net_amount,
    })),
    z.object({ id: z.uuid(), status: z.enum(["processing", "failed"]) })
      .transform((row) => ({ status: row.status })),
  ]).nullable(),
});

export async function getUploadOutcome(
  supabase: SupabaseClient, userId: string, uploadId: string,
): Promise<UploadOutcomeRecord | null> {
  const { data } = await readQuery("getUploadOutcome", () => supabase.from("uploads")
    .select("id, status, inserted_count, duplicate_count, skipped_count, period_from, period_to, net_amount")
    .eq("user_id", userId).eq("id", uploadId).maybeSingle(), uploadResponseSchema);
  return data;
}

const PAGE_SIZE = 1000;
const doneUploadsResponseSchema = z.object({
  data: z.array(z.object({
    id: z.uuid(), card_id: z.uuid(), file_name: z.string().min(1).max(255), inserted_count: z.int().positive(),
    period_from: z.iso.date(), period_to: z.iso.date(),
  }).transform((row) => ({
    id: row.id, cardId: row.card_id, fileName: row.file_name, inserted: row.inserted_count,
    periodFrom: row.period_from, periodTo: row.period_to,
  }))),
});

export async function listDoneUploads(supabase: SupabaseClient, userId: string): Promise<DoneUpload[]> {
  const uploads: DoneUpload[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data } = await readQuery("listDoneUploads", () => supabase.from("uploads")
      .select("id, card_id, file_name, inserted_count, period_from, period_to")
      .eq("user_id", userId).eq("status", "done")
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1), doneUploadsResponseSchema);
    uploads.push(...data);
    if (data.length < PAGE_SIZE) return uploads;
  }
}
