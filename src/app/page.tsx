import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass } from "@/components/button-styles";
import { ArrowRightIcon, CheckIcon } from "@/components/icons";
import { DarkBackdrop } from "@/components/landing/dark-backdrop";
import { DemoLink } from "@/components/landing/demo-link";
import { FeatureShowcase } from "@/components/landing/feature-showcase";
import { HeroVisual } from "@/components/landing/hero-visual";
import { PlanPreview } from "@/components/landing/plan-preview";
import { StartSteps } from "@/components/landing/start-steps";
import { SummaryBand } from "@/components/landing/summary-band";
import { Wordmark } from "@/components/wordmark";
import { buildDashboard } from "@/lib/analytics/dashboard";
import { DEMO_SUMMARY, DEMO_SUMMARY_MONTH, DEMO_TODAY, DEMO_TRANSACTIONS } from "@/lib/demo/fixture";
import { formatWon } from "@/lib/format";

const PRO_PRICE_KRW = 6_900; // 임시값: PRD [확정 필요]

const freeFeatures = ["월별 소비 현황", "전월 대비", "확인할 지출 건수와 합계", "월간 요약"];
const proFeatures = ["Free의 모든 기능", "확인할 지출 상세", "최대 12개월 추세", "더 자세한 월간 요약"];

export default function Page(): React.JSX.Element {
  const dashboard = buildDashboard({
    transactions: DEMO_TRANSACTIONS,
    plan: "pro",
    today: DEMO_TODAY,
  });
  if (dashboard === null || dashboard.plan !== "pro") notFound();

  const { month, snapshot, findings } = dashboard;
  const cardLabels = [...new Set(DEMO_TRANSACTIONS.map(({ cardLabel }) => cardLabel))];
  cardLabels.sort((a, b) => a.localeCompare(b, "ko"));

  return (
    <main>
      <section className="relative isolate overflow-hidden bg-surface-dark text-white">
        <DarkBackdrop light="right" />
        <div className="mx-auto max-w-[1248px] px-6 py-24">
          <header className="flex items-center justify-between gap-6">
            <Wordmark tone="onDark" />
            <Link
              href="/login"
              className="rounded-lg font-semibold text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              로그인
            </Link>
          </header>

          <div className="mt-16 grid items-center gap-12 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <h1 className="text-display-sm font-normal lg:text-display-xl">
                계좌 연동 없이,<br />카드 이용내역 파일만으로
              </h1>
              <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-soft">
                흩어진 카드 지출을 한 화면에서 보고, 정기결제와 확인이 필요한 지출을 찾아드려요.
              </p>
              <DemoLink className={`${buttonClass("primary")} mt-8`}>
                데모 보기
                <ArrowRightIcon
                  size={18}
                  className="transition-transform duration-200 ease-standard group-hover:translate-x-1"
                />
              </DemoLink>
              <p className="mt-3 text-caption text-muted-soft">
                로그인 없이 바로 볼 수 있어요
              </p>
            </div>

            <HeroVisual
              month={month}
              cardLabels={cardLabels}
              snapshot={snapshot}
              findings={findings}
            />
          </div>
        </div>
      </section>

      <section className="bg-canvas">
        <div className="mx-auto max-w-[1248px] px-6 py-24">
          <h2 className="reveal text-display-sm font-normal text-ink">파일 하나로 시작해요</h2>
          <FeatureShowcase
            month={month}
            dataMonths={dashboard.months.map(({ month }) => month)}
            cardLabels={cardLabels}
            snapshot={snapshot}
            findings={findings}
          />
        </div>
      </section>

      {month === DEMO_SUMMARY_MONTH && (
        <SummaryBand
          month={month}
          summary={DEMO_SUMMARY}
          findings={findings}
          trend={dashboard.trend}
          mom={dashboard.mom}
        />
      )}

      <section className="bg-surface-soft">
        <div className="mx-auto max-w-[1248px] px-6 py-24">
          <h2 className="reveal text-display-sm font-normal text-ink">이렇게 시작해요</h2>
          <StartSteps cardLabel={cardLabels[0]} />
        </div>
      </section>

      <section className="bg-canvas">
        <div className="mx-auto max-w-[1248px] px-6 py-24">
          <div className="reveal">
            <h2 className="text-display-sm font-normal text-ink">요금</h2>
            <p className="mt-4 text-lg text-body">
              Free로 시작하고, 상세가 필요할 때 Pro로 바꿔요.
            </p>
          </div>
          <div className="reveal mt-10 grid gap-6 sm:grid-cols-2">
            <article className="flex flex-col rounded-3xl border border-hairline bg-canvas p-6 sm:p-8">
              <h3 className="text-lg font-semibold text-ink">Free</h3>
              <p className="mt-6 text-display-md font-normal tabular-nums text-ink">0원</p>
              <ul className="my-8 space-y-3 text-base text-body">
                {freeFeatures.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <CheckIcon className="mt-0.5 shrink-0 text-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <PlanPreview plan="free" findings={findings} />
              <Link href="/login" className={`${buttonClass("secondary")} mt-auto w-full`}>
                무료로 시작하기
              </Link>
            </article>

            <article className="flex flex-col rounded-3xl bg-surface-dark p-6 text-white shadow-float sm:p-8">
              <h3 className="text-lg font-semibold">Pro</h3>
              <p className="mt-6 text-display-md font-normal tabular-nums">
                {`월 ${formatWon(PRO_PRICE_KRW)}`}
              </p>
              <ul className="my-8 space-y-3 text-base text-muted-soft">
                {proFeatures.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <CheckIcon className="mt-0.5 shrink-0 text-primary-on-dark" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <PlanPreview plan="pro" findings={findings} />
              <Link href="/login" className={`${buttonClass("primary")} mt-auto w-full`}>
                Pro 시작하기
              </Link>
            </article>
          </div>
          <p className="mt-6 text-caption text-body">
            해외에서는 $4.99/월로 결제돼요. 결제 통화는 결제 화면에서 정해져요.
          </p>
        </div>
      </section>

      <section className="relative isolate overflow-hidden bg-surface-dark text-white">
        <DarkBackdrop light="center" />
        <div className="mx-auto max-w-[1248px] px-6 py-24 text-center">
          <h2 className="reveal text-display-sm font-normal sm:text-display-md">
            이번 달 카드 지출, 파일 하나로 확인해 보세요
          </h2>
          <div className="reveal">
            <Link href="/login" className={`${buttonClass("primary")} mt-8`}>
              무료로 시작하기
              <ArrowRightIcon
                size={18}
                className="transition-transform duration-200 ease-standard group-hover:translate-x-1"
              />
            </Link>
            <p className="mt-6 text-caption text-muted-soft">
              구글 계정으로 시작해요. 카드번호는 받지 않아요.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
