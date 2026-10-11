import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoLink } from "@/components/landing/demo-link";
import { Wordmark } from "@/components/wordmark";
import { buildDashboard } from "@/lib/analytics/dashboard";
import { DEMO_TODAY, DEMO_TRANSACTIONS } from "@/lib/demo/fixture";
import { formatMonth, formatWon } from "@/lib/format";
import { CATEGORY_LABELS } from "@/types/category";

const PRO_PRICE_KRW = 6_900; // 임시값: PRD [확정 필요]

const BUTTON_CLASS = "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-base font-semibold transition-[background-color,transform] duration-120 ease-standard active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const PRIMARY_BUTTON_CLASS = `${BUTTON_CLASS} bg-primary text-white active:bg-primary-active`;
const SECONDARY_BUTTON_CLASS = `${BUTTON_CLASS} bg-surface-strong text-ink active:bg-hairline`;

const features = [
  {
    title: "한 화면에 모든 카드",
    description: "카드사마다 받은 이용내역 파일을 올리면 카드별로 나눠 합산해요.",
  },
  {
    title: "확인이 필요한 지출",
    description: "정기결제로 보이는 결제, 중복 결제 의심, 평소보다 큰 결제를 찾아드려요. 정상 지출일 수도 있어요.",
  },
  {
    title: "연동 없이, 언제든 삭제",
    description: "계좌나 카드사에 연동하지 않아요. 원본 파일은 암호화해 보관하고, 원할 때 바로 지울 수 있어요.",
  },
];

export default function Page(): React.JSX.Element {
  const dashboard = buildDashboard({
    transactions: DEMO_TRANSACTIONS,
    plan: "pro",
    today: DEMO_TODAY,
  });
  if (dashboard === null || dashboard.plan !== "pro") notFound();

  const { month, snapshot, findings } = dashboard;
  const categories = snapshot.categories.slice(0, 3);
  const maxCategoryAmount = Math.max(0, ...categories.map(({ amount }) => amount));
  const candidateCount = Object.values(findings.byKind)
    .reduce((sum, { count }) => sum + count, 0);

  return (
    <main>
      <section className="bg-surface-dark text-white">
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
              <p className="mt-6 max-w-lg text-lg text-muted-soft">
                흩어진 카드 지출을 한 화면에서 보고, 정기결제와 확인이 필요한 지출을 찾아드려요.
              </p>
              <DemoLink className={`${PRIMARY_BUTTON_CLASS} mt-8`}>
                데모 보기
              </DemoLink>
              <p className="mt-3 text-caption text-muted-soft">
                로그인 없이 바로 볼 수 있어요
              </p>
            </div>

            <div className="min-w-0 rounded-3xl border border-hairline-dark bg-surface-dark-elevated p-8">
              <p className="text-sm tabular-nums text-muted-soft">
                {`${formatMonth(month)} 총지출`}
              </p>
              <p className="mt-3 font-mono text-3xl font-medium text-white">
                {formatWon(snapshot.total)}
              </p>
              <ul aria-label="예시 상위 카테고리" className="mt-6">
                {categories.map(({ category, amount }) => (
                  <li key={category} className="border-b border-hairline-dark py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span>{CATEGORY_LABELS[category]}</span>
                      <span className="text-right font-mono">{formatWon(amount)}</span>
                    </div>
                    {amount > 0 && (
                      <div
                        aria-hidden="true"
                        className="mt-2 h-2 rounded-r-[4px] bg-primary"
                        style={{ width: `${(amount / maxCategoryAmount) * 100}%` }}
                      />
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm tabular-nums text-white">
                {`확인이 필요한 지출 ${candidateCount}건 · 후보 합계 ${formatWon(findings.candidateTotal)}`}
              </p>
              <p className="mt-3 text-caption text-muted-soft">예시 데이터</p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-canvas">
        <div className="mx-auto max-w-[1248px] px-6 py-24">
          <h2 className="text-display-sm font-normal text-ink">파일 하나로 시작해요</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ title, description }) => (
              <article key={title} className="rounded-3xl border border-hairline bg-canvas p-6 sm:p-8">
                <h3 className="text-lg font-semibold text-ink">{title}</h3>
                <p className="mt-4 text-base leading-relaxed text-body">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-surface-soft">
        <div className="mx-auto max-w-[1248px] px-6 py-24">
          <h2 className="text-display-sm font-normal text-ink">요금</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            <article className="flex flex-col rounded-3xl border border-hairline bg-canvas p-6 sm:p-8">
              <h3 className="text-lg font-semibold text-ink">Free</h3>
              <p className="mt-6 font-mono text-display-md font-normal text-ink">0원</p>
              <ul className="my-8 space-y-3 text-base text-body">
                <li>월별 소비 현황</li>
                <li>전월 대비</li>
                <li>확인할 지출 건수와 합계</li>
                <li>월간 요약</li>
              </ul>
              <Link href="/login" className={`${SECONDARY_BUTTON_CLASS} mt-auto w-full`}>
                무료로 시작하기
              </Link>
            </article>

            <article className="flex flex-col rounded-3xl bg-surface-dark p-6 text-white sm:p-8">
              <h3 className="text-lg font-semibold">Pro</h3>
              <p className="mt-6 text-display-md font-normal tabular-nums">
                {`월 ${formatWon(PRO_PRICE_KRW)}`}
              </p>
              <ul className="my-8 space-y-3 text-base text-muted-soft">
                <li>Free의 모든 기능</li>
                <li>확인할 지출 상세</li>
                <li>최대 12개월 추세</li>
                <li>더 자세한 월간 요약</li>
              </ul>
              <Link href="/login" className={`${PRIMARY_BUTTON_CLASS} mt-auto w-full`}>
                Pro 시작하기
              </Link>
            </article>
          </div>
          <p className="mt-6 text-caption text-body">
            해외에서는 $4.99/월로 결제돼요. 결제 통화는 결제 화면에서 정해져요.
          </p>
        </div>
      </section>

      <section className="bg-surface-dark text-white">
        <div className="mx-auto max-w-[1248px] px-6 py-24 text-center">
          <h2 className="text-display-sm font-normal sm:text-display-md">
            이번 달 카드 지출, 파일 하나로 확인해 보세요
          </h2>
          <Link href="/login" className={`${PRIMARY_BUTTON_CLASS} mt-8`}>
            무료로 시작하기
          </Link>
          <p className="mt-6 text-caption text-muted-soft">
            assetomy는 계좌나 카드사에 연동하지 않아요.
          </p>
        </div>
      </section>
    </main>
  );
}
