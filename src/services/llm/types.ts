import "server-only";
import type { CategoryId } from "@/types/category";

export type MerchantInput = { merchantKey: string; merchant: string };

export interface MerchantClassifier {
  // Returns every input key; unclassified keys receive etc. Never rejects.
  classify(merchants: MerchantInput[]): Promise<Map<string, CategoryId>>;
}
