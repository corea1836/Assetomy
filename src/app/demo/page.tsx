import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryList } from "@/components/dashboard/category-list";
import { DailyChart } from "@/components/dashboard/daily-chart";
import { FindingsList } from "@/components/dashboard/findings-list";
import { MonthSelect } from "@/components/dashboard/month-select";
import { MonthlySummary } from "@/components/dashboard/monthly-summary";
import { TopMerchants } from "@/components/dashboard/top-merchants";
import { TotalCard } from "@/components/dashboard/total-card";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { Wordmark } from "@/components/wordmark";
import { buildDashboard } from "@/lib/analytics/dashboard";
import { monthOf } from "@/lib/analytics/dates";
import { DEMO_SUMMARY, DEMO_TODAY, DEMO_TRANSACTIONS } from "@/lib/demo/fixture";
import { formatMonth } from "@/lib/format";

export const metadata = { title: "데모 · assetomy" };

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const dashboard = buildDashboard({
    transactions: DEMO_TRANSACTIONS,
    plan: "pro",
    month: typeof params.month === "string" ? params.month : undefined,
    today: DEMO_TODAY,
  });
  if (dashboard === null || dashboard.plan !== "pro") notFound();

  const { month, months, lastDate, snapshot, mom, findings, trend } = dashboard;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-12 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Wordmark />
          </Link>
          <span className="text-caption text-body">데모</span>
        </div>
        <Link
          href="/login"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-120 ease-standard active:scale-[.98] active:bg-primary-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          내 이용내역으로 해보기
        </Link>
      </header>

      <main className="space-y-12 pt-6">
        <p className="text-caption text-body">
          예시 데이터로 만든 화면이에요. 실제 카드 내역이 아니에요.
        </p>

        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-title-lg text-ink">
            {`${formatMonth(month)} 지출`}
          </h1>
          <MonthSelect months={months} month={month} />
          <p className="text-caption tabular-nums text-body">
            {`${formatMonth(monthOf(lastDate))}까지 반영됨`}
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <TotalCard snapshot={snapshot} mom={mom} />
          <CategoryList categories={snapshot.categories} />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <TopMerchants merchants={snapshot.topMerchants} />
          <DailyChart daily={snapshot.daily} />
        </div>

        <FindingsList findings={findings} dataMonthCount={months.length} />
        {trend !== null && <TrendChart trend={trend} />}
        {month === "2026-09" ? (
          <MonthlySummary summary={DEMO_SUMMARY} />
        ) : (
          <p className="text-caption text-body">
            데모 요약은 2026년 9월에만 있어요
          </p>
        )}
      </main>
    </div>
  );
}
