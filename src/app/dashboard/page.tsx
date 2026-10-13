import Link from "next/link";
import { buttonClass } from "@/components/button-styles";
import { Wordmark } from "@/components/wordmark";
import { HyundaiGuide } from "@/components/upload/hyundai-guide";
import { Onboarding } from "@/components/upload/onboarding";
import { UploadPanel } from "@/components/upload/upload-panel";
import { requireUser } from "@/lib/auth";
import { formatPeriod } from "@/lib/format";
import { listCards } from "@/lib/queries/cards";
import { getTransactionCoverage } from "@/lib/queries/transactions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "대시보드 · assetomy" };

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const user = await requireUser("/dashboard");
  const supabase = await createSupabaseServerClient();
  const [cards, coverage] = await Promise.all([
    listCards(supabase, user.id), getTransactionCoverage(supabase, user.id),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-12 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <Link
          href="/"
          className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Wordmark />
        </Link>
        <form method="post" action="/auth/logout">
          <button type="submit" className={buttonClass("secondary", "sm")}>
            로그아웃
          </button>
        </form>
      </header>

      <main className="pt-6">
        <div className={coverage.count === 0 ? "space-y-4" : "space-y-12"}>
          <div>
            {coverage.count === 0 ? <Onboarding /> : (
              <section>
                <h1 className="text-title-lg text-ink">올린 이용내역</h1>
                <p className="mt-3 text-base tabular-nums text-body">
                  거래 {coverage.count}건 · 반영 기간 {coverage.from && coverage.to && formatPeriod({ from: coverage.from, to: coverage.to })}
                </p>
                <p className="mt-2 text-caption text-body">월별 대시보드는 준비하고 있어요</p>
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
      </main>
    </div>
  );
}
