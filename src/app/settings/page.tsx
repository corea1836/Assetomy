import Link from "next/link";
import { ManageSubscriptionButton } from "@/components/billing/manage-subscription-button";
import { UpgradeButton } from "@/components/billing/upgrade-button";
import { buttonClass } from "@/components/button-styles";
import { Wordmark } from "@/components/wordmark";
import { requireUser } from "@/lib/auth";
import { defaultBillingDeps } from "@/lib/billing/deps";
import { getPlanState } from "@/lib/billing/plan";
import { getSubscription } from "@/lib/queries/subscriptions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "설정 · assetomy" };

export default async function SettingsPage(): Promise<React.JSX.Element> {
  const user = await requireUser("/settings");
  const stored = await getSubscription(await createSupabaseServerClient(), user.id);
  const planState = await getPlanState(user.id, stored, defaultBillingDeps());

  return (
    <div className="mx-auto max-w-5xl px-4 pb-12 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <Link href="/" className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><Wordmark /></Link>
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className={buttonClass("secondary", "sm")}>대시보드</Link>
          <form method="post" action="/auth/logout">
            <button type="submit" className={buttonClass("secondary", "sm")}>로그아웃</button>
          </form>
        </div>
      </header>
      <main className="space-y-12 pt-6">
        <h1 className="text-title-lg text-ink">설정</h1>
        <section className="rounded-3xl border border-hairline bg-canvas p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-ink">플랜</h2>
          {planState.plan === "free" ? (
            <>
              <p className="mt-4 text-base text-body">Free 플랜을 쓰고 있어요</p>
              <div className="mt-6"><UpgradeButton source="settings" label="업그레이드" /></div>
            </>
          ) : (
            <>
              <span className="mt-4 inline-block rounded-full bg-primary-soft px-2.5 py-0.5 text-caption font-semibold text-primary-active">Pro</span>
              {planState.periodEnd && <p className="mt-3 text-base tabular-nums text-body">
                {planState.cancelAtPeriodEnd ? `${planState.periodEnd}까지 Pro로 쓸 수 있어요` : `다음 결제일 ${planState.periodEnd}`}
              </p>}
              <div className="mt-6"><ManageSubscriptionButton /></div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
