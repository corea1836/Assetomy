import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass } from "@/components/button-styles";
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
import {
  DEMO_SUMMARY,
  DEMO_SUMMARY_MONTH,
  DEMO_TODAY,
  DEMO_TRANSACTIONS,
} from "@/lib/demo/fixture";
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
        <Link href="/login" className={buttonClass("primary", "sm")}>
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
          <div className="flex flex-col gap-6">
            <TotalCard snapshot={snapshot} mom={mom} />
            {month === DEMO_SUMMARY_MONTH ? (
              <MonthlySummary summary={DEMO_SUMMARY} source="example" />
            ) : (
              <p className="text-caption text-body">
                데모 요약은 2026년 9월에만 있어요
              </p>
            )}
          </div>
          <CategoryList categories={snapshot.categories} />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <TopMerchants merchants={snapshot.topMerchants} />
          <DailyChart daily={snapshot.daily} />
        </div>

        {/* 데모는 Pro 화면이다. 가입 후 Free 화면과의 차이를 미리 밝힌다(UX_GUIDE) */}
        <div className="flex items-start gap-3 border-t border-hairline pt-8">
          <span className="shrink-0 rounded-full bg-primary-soft px-2.5 py-0.5 text-caption font-semibold text-primary-active">
            Pro
          </span>
          <p className="min-w-0 pt-0.5 text-caption text-body">
            여기부터 Pro 화면이에요. Free에서는 확인할 지출의 건수와 합계만 보여요.
          </p>
        </div>

        <FindingsList findings={findings} dataMonthCount={months.length} />
        {trend !== null && <TrendChart trend={trend} />}
        <section className="rounded-3xl bg-surface-soft p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-ink">내 카드로 확인해 보세요</h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-body">
            카드사에서 받은 이용내역 파일을 올리면 이 화면이 내 숫자로 바뀌어요. 최근 3개월치를 올리면 정기결제까지 찾아드려요.
          </p>
          <Link href="/login" className={`${buttonClass("primary")} mt-6`}>
            내 이용내역으로 해보기
          </Link>
        </section>
      </main>
    </div>
  );
}
