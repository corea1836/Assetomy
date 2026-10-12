import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "./admin";

const { fakeClient } = vi.hoisted(() => ({ fakeClient: { rpc: vi.fn() } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => fakeClient) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
});
afterEach(() => vi.unstubAllEnvs());

describe("createSupabaseAdminClient", () => {
  it("uses the secret key and disables all session handling", () => {
    expect(createSupabaseAdminClient()).toBe(fakeClient);
    expect(createClient).toHaveBeenCalledExactlyOnceWith(
      "https://example.supabase.co", "sb_secret_test",
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
  });

  it("validates settings lazily before creating a client", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", undefined);
    expect(() => createSupabaseAdminClient()).toThrowError(/^SUPABASE_SECRET_KEY$/);
    expect(createClient).not.toHaveBeenCalled();
  });
});
