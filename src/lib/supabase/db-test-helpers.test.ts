import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, deleteTestUser } from "./db-test-helpers";

const { createUser, deleteUser } = vi.hoisted(() => ({ createUser: vi.fn(), deleteUser: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({ auth: { admin: { createUser, deleteUser } } })),
}));
beforeEach(() => { createUser.mockReset(); deleteUser.mockReset(); });

describe("DB test users", () => {
  it("creates unique, confirmed test emails and returns only the ID", async () => {
    createUser.mockResolvedValue({ data: { user: { id: "test-id", email: "private" } }, error: null });
    expect(await createTestUser()).toEqual({ id: "test-id" });
    await createTestUser();
    const first = createUser.mock.calls[0][0];
    expect(first).toEqual({ email: expect.stringMatching(/^db-test\+[0-9a-f-]{36}@assetomy\.test$/), email_confirm: true });
    expect(createUser.mock.calls[1][0].email).not.toBe(first.email);
  });

  it("hard deletes the specified test user", async () => {
    deleteUser.mockResolvedValue({ error: null });
    await expect(deleteTestUser("test-id")).resolves.toBeUndefined();
    expect(deleteUser).toHaveBeenCalledExactlyOnceWith("test-id");
  });

  it("does not expose sensitive Auth errors", async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { code: "unexpected_failure", message: "private" } });
    deleteUser.mockResolvedValue({ error: { code: "unexpected_failure", message: "private" } });
    await expect(createTestUser()).rejects.toThrowError(/^db-test:create_user:unexpected_failure$/);
    await expect(deleteTestUser("test-id")).rejects.toThrowError(/^db-test:delete_user:unexpected_failure$/);
  });

  it("rejects a missing created user", async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(createTestUser()).rejects.toThrowError(/^db-test:create_user:unexpected_response$/);
  });
});
