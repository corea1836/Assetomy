import { fireEvent, render, screen } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUser } from "@/lib/auth";
import { defaultBillingDeps, type BillingDeps } from "@/lib/billing/deps";
import { getPlanState } from "@/lib/billing/plan";
import { getSubscription } from "@/lib/queries/subscriptions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StoredSubscription } from "@/types/billing";
import SettingsPage, { metadata } from "./page";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/billing/deps", () => ({ defaultBillingDeps: vi.fn() }));
vi.mock("@/lib/billing/plan", () => ({ getPlanState: vi.fn() }));
vi.mock("@/lib/queries/subscriptions", () => ({ getSubscription: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

const supabase = {} as SupabaseClient;
const deps = {} as BillingDeps;
const pro: StoredSubscription = { plan: "pro", currentPeriodEnd: "2026-11-12T15:30:00Z", cancelAtPeriodEnd: true };

beforeEach(() => {
  vi.mocked(requireUser).mockReset().mockResolvedValue({ id: "private-user-id" });
  vi.mocked(createSupabaseServerClient).mockReset().mockResolvedValue(supabase);
  vi.mocked(getSubscription).mockReset().mockResolvedValue(null);
  vi.mocked(defaultBillingDeps).mockReset().mockReturnValue(deps);
  vi.mocked(getPlanState).mockReset().mockResolvedValue({ plan: "free" });
});

describe("settings page", () => {
  it("requires a session, reads the subscription through RLS and offers Free upgrade", async () => {
    const { container } = render(await SettingsPage());
    expect(requireUser).toHaveBeenCalledExactlyOnceWith("/settings");
    expect(getSubscription).toHaveBeenCalledExactlyOnceWith(supabase, "private-user-id");
    expect(defaultBillingDeps).toHaveBeenCalledOnce();
    expect(getPlanState).toHaveBeenCalledExactlyOnceWith("private-user-id", null, deps, { sync: true });
    expect(metadata.title).toBe("설정 · assetomy");
    expect(screen.getByRole("heading", { name: "설정", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "플랜", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Free 플랜을 쓰고 있어요")).toBeInTheDocument();
    const upgrade = screen.getByRole("button", { name: "업그레이드" });
    expect(upgrade).toHaveClass("bg-primary");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "구독 관리" })).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/올린 파일|업로드 내역|전체 삭제|탈퇴|private-user-id/);
    expect(container.firstElementChild).toHaveClass("max-w-5xl", "mx-auto", "px-4", "sm:px-6");
    fireEvent.click(upgrade);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the Pro badge, cancellation end date and subscription management", async () => {
    vi.mocked(getSubscription).mockResolvedValue(pro);
    vi.mocked(getPlanState).mockResolvedValue({ plan: "pro", periodEnd: "2026-11-13", cancelAtPeriodEnd: true });
    const { container } = render(await SettingsPage());
    expect(getPlanState).toHaveBeenCalledExactlyOnceWith("private-user-id", pro, deps, { sync: true });
    expect(screen.getByText("Pro")).toHaveClass("rounded-full", "bg-primary-soft", "text-primary-active");
    expect(screen.getByText("2026-11-13까지 Pro로 쓸 수 있어요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "구독 관리" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "업그레이드" })).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/업로드 내역|전체 삭제|탈퇴/);
  });

  it("shows the next payment date for a renewing Pro plan", async () => {
    vi.mocked(getPlanState).mockResolvedValue({ plan: "pro", periodEnd: "2026-11-13", cancelAtPeriodEnd: false });
    render(await SettingsPage());
    expect(screen.getByText("다음 결제일 2026-11-13")).toBeInTheDocument();
    expect(screen.queryByText(/까지 Pro로 쓸 수 있어요/)).not.toBeInTheDocument();
  });

  it.each([false, true])("omits dates when mock Pro has no period end (cancellation: %s)", async (cancelAtPeriodEnd) => {
    vi.mocked(getPlanState).mockResolvedValue({ plan: "pro", periodEnd: null, cancelAtPeriodEnd });
    const { container } = render(await SettingsPage());
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "구독 관리" })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/다음 결제일|까지 Pro로|\d{4}-\d{2}-\d{2}/);
  });

  it("offers the home wordmark, dashboard link and logout form in the header", async () => {
    render(await SettingsPage());
    const home = screen.getByRole("link", { name: "assetomy" });
    expect(home).toHaveAttribute("href", "/");
    const dashboard = screen.getByRole("link", { name: "대시보드" });
    expect(dashboard).toHaveAttribute("href", "/dashboard");
    expect(dashboard).toHaveClass("bg-surface-strong", "h-9");
    const logout = screen.getByRole("button", { name: "로그아웃" });
    expect(logout).toHaveClass("bg-surface-strong", "h-9");
    expect(logout.closest("form")).toHaveAttribute("action", "/auth/logout");
    expect(logout.closest("form")).toHaveAttribute("method", "post");
    expect(logout.closest("header")).toBe(home.closest("header"));
  });

  it("propagates the login redirect before reading protected data", async () => {
    const redirect = new Error("REDIRECT:/login?next=%2Fsettings");
    vi.mocked(requireUser).mockRejectedValue(redirect);
    await expect(SettingsPage()).rejects.toBe(redirect);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(getSubscription).not.toHaveBeenCalled();
    expect(getPlanState).not.toHaveBeenCalled();
  });
});
