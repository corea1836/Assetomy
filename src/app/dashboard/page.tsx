import Link from "next/link";
import { CheckoutNotice } from "@/components/billing/checkout-notice";
import { PricingUpgrade } from "@/components/billing/pricing-upgrade";
import { buttonClass } from "@/components/button-styles";
import { Wordmark } from "@/components/wordmark";
import { HyundaiGuide } from "@/components/upload/hyundai-guide";
import { Onboarding } from "@/components/upload/onboarding";
import { UploadHistory } from "@/components/upload/upload-history";
import { UploadPanel } from "@/components/upload/upload-panel";
import { requireUser } from "@/lib/auth";
import { defaultBillingDeps } from "@/lib/billing/deps";
import { getPlanState } from "@/lib/billing/plan";
import { formatPeriod } from "@/lib/format";
import { listCards } from "@/lib/queries/cards";
import { getSubscription } from "@/lib/queries/subscriptions";
import { getTransactionCoverage } from "@/lib/queries/transactions";
import { listDoneUploads } from "@/lib/queries/uploads";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "대시보드 · assetomy" };

export default async function DashboardPage({ searchParams }: {
  searchParams: Promise<{ checkout?: string | string[]; upgrade?: string | string[] }>;
}): Promise<React.JSX.Element> {
  const user = await requireUser("/dashboard");
  const params = await searchParams;
  const checkout = Array.isArray(params.checkout) ? params.checkout[0] : params.checkout;
  const upgrade = Array.isArray(params.upgrade) ? params.upgrade[0] : params.upgrade;
  const supabase = await createSupabaseServerClient();
  const [cards, coverage, doneUploads, stored] = await Promise.all([
    listCards(supabase, user.id), getTransactionCoverage(supabase, user.id), listDoneUploads(supabase, user.id),
    getSubscription(supabase, user.id),
  ]);
  const planState = await getPlanState(user.id, stored, defaultBillingDeps(), { sync: checkout === "success" });
  const cardLabels = new Map(cards.map((card) => [card.id, card.label]));
  const history = doneUploads.map(({ cardId, ...upload }) => ({ ...upload, cardLabel: cardLabels.get(cardId) ?? null }));

  return (
    <div className="mx-auto max-w-5xl px-4 pb-12 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <Link
          href="/"
          className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Wordmark />
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/settings" className={buttonClass("secondary", "sm")}>설정</Link>
          <form method="post" action="/auth/logout">
            <button type="submit" className={buttonClass("secondary", "sm")}>로그아웃</button>
          </form>
        </div>
      </header>

      <main className="pt-6">
        {checkout === "success" && <CheckoutNotice plan={planState.plan} />}
        {upgrade === "pricing" && checkout !== "success" && planState.plan === "pro" && (
          <div role="status" aria-live="polite" className="mb-6 rounded-3xl bg-primary-soft p-6 text-primary-active">
            <p>이미 Pro를 쓰고 있어요</p>
            <Link href="/settings" className="mt-3 inline-block rounded-lg font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:text-primary-active">구독 관리</Link>
          </div>
        )}
        <div className={coverage.count === 0 ? "space-y-4" : "space-y-12"}>
          <div>
            {coverage.count === 0 ? <Onboarding /> : (
              <section>
                <h1 className="text-title-lg text-ink">올린 이용내역</h1>
                <p className="mt-3 text-base tabular-nums text-body">
                  거래 {coverage.count}건 · 반영 기간 {coverage.from && coverage.to && formatPeriod({ from: coverage.from, to: coverage.to })}
                </p>
                <p className="mt-2 text-caption text-body">월별 대시보드는 준비하고 있어요</p>
                <div className="mt-8"><UploadHistory uploads={history} /></div>
              </section>
            )}
          </div>
          <section>
            {coverage.count > 0 && (
              <>
                <h2 className="text-lg font-semibold text-ink">새 이용내역 추가</h2>
                <HyundaiGuide />
              </>
            )}
            <div className={coverage.count > 0 ? "mt-4" : ""}><UploadPanel cards={cards} /></div>
          </section>
        </div>
        {upgrade === "pricing" && planState.plan === "free" && <PricingUpgrade />}
      </main>
    </div>
  );
}
