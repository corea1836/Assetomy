import "server-only";
import { z } from "zod";
import type { CategoryId, SetMerchantCategoryResult } from "@/types/category";
import { callStoreRpc } from "./store-error";

const setMerchantCategoryResultSchema = z.union([
  z.object({ kind: z.literal("updated"), updated: z.int().nonnegative() }),
  z.object({ kind: z.literal("not_found") }),
]);

export async function setMerchantCategory(
  userId: string, merchantKey: string, category: CategoryId,
): Promise<SetMerchantCategoryResult> {
  return callStoreRpc("set_merchant_category", {
    p_user_id: userId, p_merchant_key: merchantKey, p_category: category,
  }, setMerchantCategoryResultSchema);
}
