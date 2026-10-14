import Link from "next/link";
import { Suspense } from "react";
import { CheckoutNotice } from "@/components/billing/checkout-notice";
import { PricingUpgrade } from "@/components/billing/pricing-upgrade";
import { buttonClass } from "@/components/button-styles";
import { MonthlySummarySection } from "./monthly-summary-section";
import { CardSummarySection } from "./card-summary-section";
import { CategoryList } from "@/components/dashboard/category-list";
import { CardTabs } from "@/components/dashboard/card-tabs";
import { CardHeading } from "@/components/dashboard/card-heading";
import { StatementTotalCard } from "@/components/dashboard/statement-total-card";
import { CategoryChangesCard } from "@/components/dashboard/category-changes-card";
import { EmptyCard } from "@/components/dashboard/empty-card";
import { DailyChart } from "@/components/dashboard/daily-chart";
import { FindingsList } from "@/components/dashboard/findings-list";
import { MonthSelect } from "@/components/dashboard/month-select";
import { TeaserCard } from "@/components/dashboard/teaser-card";
import { TopMerchants } from "@/components/dashboard/top-merchants";
import { TotalCard } from "@/components/dashboard/total-card";
import { MonthlySummaryStatus } from "@/components/dashboard/monthly-summary";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { TrendLockCard } from "@/components/dashboard/trend-lock-card";
import { Wordmark } from "@/components/wordmark";
import { HyundaiGuide } from "@/components/upload/hyundai-guide";
import { Onboarding } from "@/components/upload/onboarding";
import { UploadHistory } from "@/components/upload/upload-history";
import { UploadPanel } from "@/components/upload/upload-panel";
import { buildCardDashboard, buildDashboard } from "@/lib/analytics/dashboard";
import { monthOf } from "@/lib/analytics/dates";
import { prepareSummary } from "@/lib/summary/monthly-summary";
import { prepareCardSummary } from "@/lib/summary/card-summary";
import { defaultCardSummaryDeps, defaultSummaryDeps } from "@/lib/summary/deps";
import { requireUser } from "@/lib/auth";
import { defaultBillingDeps } from "@/lib/billing/deps";
import { getPlanState } from "@/lib/billing/plan";
import { seoulToday } from "@/lib/clock";
import { formatMonth } from "@/lib/format";
import { listCards } from "@/lib/queries/cards";
import { listStatements } from "@/lib/queries/statements";
import { getSubscription } from "@/lib/queries/subscriptions";
import { listTransactions } from "@/lib/queries/transactions";
import { listDoneUploads } from "@/lib/queries/uploads";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "대시보드 · assetomy" };

export default async function DashboardPage({ searchParams }: {
  searchParams: Promise<{
    month?: string | string[];
    card?: string | string[];
    statement?: string | string[];
    checkout?: string | string[];
    upgrade?: string | string[];
  }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const month = typeof params.month === "string" ? params.month : undefined;
  const card = Array.isArray(params.card) ? params.card[0] : params.card;
  const statement = Array.isArray(params.statement) ? params.statement[0] : params.statement;
  const checkout = Array.isArray(params.checkout) ? params.checkout[0] : params.checkout;
  const upgrade = Array.isArray(params.upgrade) ? params.upgrade[0] : params.upgrade;
  const nextParams = new URLSearchParams();
  if (month !== undefined && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) nextParams.set("month", month);
  if (card !== undefined && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(card)) {
    nextParams.set("card", card.toLowerCase());
  }
  if (statement !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(statement)) nextParams.set("statement", statement);
  if (upgrade === "pricing") nextParams.set("upgrade", "pricing");
  const user = await requireUser(`/dashboard${nextParams.size > 0 ? `?${nextParams}` : ""}`);
  const supabase = await createSupabaseServerClient();
  const [cards, doneUploads, stored, statements] = await Promise.all([
    listCards(supabase, user.id), listDoneUploads(supabase, user.id),
    getSubscription(supabase, user.id), listStatements(supabase, user.id),
  ]);
  const cardLabels = new Map(cards.map((card) => [card.id, card.label]));
  const [transactions, planState] = await Promise.all([
    listTransactions(supabase, user.id, cardLabels),
    getPlanState(user.id, stored, defaultBillingDeps(), { sync: checkout === "success" }),
  ]);
  const today = seoulToday();
  const dashboard = buildDashboard({ transactions, plan: planState.plan, month, today });
  const activeCard = card === undefined ? null : cards.find(({ id }) => id === card.toLowerCase()) ?? null;
  const cardDashboard = activeCard === null || dashboard === null
    ? null
    : buildCardDashboard({ card: activeCard, transactions, statements, plan: planState.plan, month, statement, today });
  const cardSummaryDeps = cardDashboard === null ? null : defaultCardSummaryDeps(supabase);
  const preparedCardSummary = cardDashboard === null || cardSummaryDeps === null
    ? null
    : prepareCardSummary(cardDashboard, cardSummaryDeps.summarizer);
  const summaryDeps = dashboard === null || activeCard !== null ? null : defaultSummaryDeps(supabase);
  const preparedSummary = dashboard === null || summaryDeps === null
    ? null
    : prepareSummary(dashboard, summaryDeps.summarizer);
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
        <div className={dashboard === null ? "space-y-4" : "space-y-12"}>
          <div>
            {dashboard === null ? <Onboarding /> : (
              activeCard === null ? (
                <div className="space-y-12">
                  <CardTabs cards={cards} activeCardId={null} />
                  <div className="space-y-12">
                    <div className="flex flex-wrap items-center gap-4">
                      <h1 className="text-title-lg text-ink">{`${formatMonth(dashboard.month)} 지출`}</h1>
                      <MonthSelect months={dashboard.months} month={dashboard.month} />
                      <p className="text-caption tabular-nums text-body">
                        {`${formatMonth(monthOf(dashboard.lastDate))}까지 반영됨`}
                      </p>
                      <Link href="#upload" className={buttonClass("secondary", "sm")}>새 이용내역 추가</Link>
                    </div>

                    {preparedSummary !== null && summaryDeps !== null && (
                      <Suspense
                        key={preparedSummary.inputHash}
                        fallback={<MonthlySummaryStatus state="pending" upgrade={dashboard.plan === "free"} />}
                      >
                        <MonthlySummarySection userId={user.id} prepared={preparedSummary} deps={summaryDeps} />
                      </Suspense>
                    )}

                    <div className="grid gap-6 md:grid-cols-2">
                      <TotalCard snapshot={dashboard.snapshot} mom={dashboard.mom} partialMonth={dashboard.partialMonth} />
                      <CategoryList categories={dashboard.snapshot.categories} total={dashboard.snapshot.total} />
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                      <TopMerchants
                        merchants={dashboard.snapshot.topMerchants}
                        otherMerchants={dashboard.snapshot.otherMerchants}
                        editable
                      />
                      <DailyChart daily={dashboard.snapshot.daily} />
                    </div>

                    {dashboard.plan === "free" ? (
                      <>
                        <TeaserCard teaser={dashboard.teaser} dataMonthCount={dashboard.months.length} />
                        {dashboard.trendAvailable && <TrendLockCard />}
                      </>
                    ) : (
                      <>
                        <FindingsList findings={dashboard.findings} dataMonthCount={dashboard.months.length} />
                        {dashboard.trend !== null && <TrendChart trend={dashboard.trend} />}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-12">
                  <CardTabs cards={cards} activeCardId={activeCard.id} />
                  <CardHeading card={activeCard} dashboard={cardDashboard} />
                  {cardDashboard === null ? <EmptyCard /> : (
                    <>
                      {preparedCardSummary !== null && cardSummaryDeps !== null && (
                        <Suspense
                          key={preparedCardSummary.inputHash}
                          fallback={(
                            <MonthlySummaryStatus
                              state="pending"
                              variant={cardDashboard.basis === "month" ? "card-month" : "statement"}
                              upgrade={cardDashboard.plan === "free"}
                            />
                          )}
                        >
                          <CardSummarySection
                            userId={user.id}
                            prepared={preparedCardSummary}
                            deps={cardSummaryDeps}
                            variant={cardDashboard.basis === "month" ? "card-month" : "statement"}
                          />
                        </Suspense>
                      )}

                      <div className="grid gap-6 md:grid-cols-2">
                        {cardDashboard.basis === "month" ? (
                          <TotalCard snapshot={cardDashboard.snapshot} mom={cardDashboard.mom} partialMonth={cardDashboard.partialMonth} />
                        ) : (
                          <StatementTotalCard
                            snapshot={cardDashboard.snapshot}
                            cyclePeriod={cardDashboard.cyclePeriod}
                            complete={cardDashboard.complete}
                            comparison={cardDashboard.comparison}
                            comparisonSkipped={cardDashboard.comparisonSkipped}
                          />
                        )}
                        <CategoryList categories={cardDashboard.snapshot.categories} total={cardDashboard.snapshot.total} />
                      </div>

                      <div className="grid gap-6 md:grid-cols-2">
                        <TopMerchants
                          merchants={cardDashboard.snapshot.topMerchants}
                          otherMerchants={cardDashboard.snapshot.otherMerchants}
                          editable
                        />
                        <DailyChart daily={cardDashboard.snapshot.daily} />
                      </div>

                      {cardDashboard.plan === "pro" && cardDashboard.categoryChanges !== null && (
                        <CategoryChangesCard changes={cardDashboard.categoryChanges} basis={cardDashboard.basis} />
                      )}
                    </>
                  )}
                </div>
              )
            )}
          </div>
          <section id="upload">
            {dashboard !== null && (
              <>
                <h2 className="text-lg font-semibold text-ink">새 이용내역 추가</h2>
                <p className="mt-2 text-caption text-body">겹치는 거래는 한 번만 반영돼요</p>
                <HyundaiGuide />
              </>
            )}
            <div className={dashboard !== null ? "mt-4" : ""}><UploadPanel cards={cards} /></div>
            {dashboard !== null && <div className="mt-8"><UploadHistory uploads={history} /></div>}
          </section>
        </div>
        {upgrade === "pricing" && planState.plan === "free" && (
          <PricingUpgrade teaser={dashboard?.plan === "free" ? dashboard.teaser : null} />
        )}
      </main>
    </div>
  );
}
