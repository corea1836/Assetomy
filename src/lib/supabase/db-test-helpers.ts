// DB 테스트 전용. 앱 코드에서 import하지 않는다.
import "server-only";
import { randomUUID } from "node:crypto";
import type { NewCardInput } from "@/types/card";
import { createSupabaseAdminClient } from "./admin";

export const TEST_CARD = { issuer: "hyundai", analysisBasis: "month", cycleStartDay: null } as const satisfies Omit<NewCardInput, "label">;

export async function createTestUser(): Promise<{ id: string }> {
  const { data, error } = await createSupabaseAdminClient().auth.admin.createUser({
    email: `db-test+${randomUUID()}@assetomy.test`,
    email_confirm: true,
  });
  if (error) throw new Error(`db-test:create_user:${error.code ?? "unexpected_response"}`);
  if (!data.user) throw new Error("db-test:create_user:unexpected_response");
  return { id: data.user.id };
}

export async function deleteTestUser(id: string): Promise<void> {
  const { error } = await createSupabaseAdminClient().auth.admin.deleteUser(id);
  if (error) throw new Error(`db-test:delete_user:${error.code ?? "unexpected_response"}`);
}
