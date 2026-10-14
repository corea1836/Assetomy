import { LoaderCircleIcon, SparklesIcon } from "@/components/icons";
import { UpgradeButton } from "@/components/billing/upgrade-button";
import { SUMMARY_STATUS_MESSAGES } from "@/lib/errors/messages";

const CARD_CLASS = "rounded-3xl border border-primary/25 bg-primary-soft bg-linear-to-br from-primary/15 via-primary-soft to-canvas p-6 shadow-glow sm:p-8";
// 코드가 자리표시자로 채운 숫자(기간·금액·건수·비율·개월)
const FILLED_NUMBER = /((?:1[0-2]|[1-9])월 [0-9]{1,2}일~(?:1[0-2]|[1-9])월 [0-9]{1,2}일|[−+]?[0-9][0-9,]*(?:원|건|%|개월))/;

type SummaryVariant = "month" | "card-month" | "statement";

function SummaryHeading({ variant }: { variant: SummaryVariant }): React.JSX.Element {
  const title = variant === "statement" ? "이번 명세서 요약" : "이번 달 요약";
  return (
    <div className="flex items-center gap-2">
      <SparklesIcon size={20} className="shrink-0 text-primary" />
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
    </div>
  );
}

function EmphasizedNumbers({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {text.split(FILLED_NUMBER).map((part, index) => (
        index % 2 === 1
          ? <strong key={index} className="font-semibold tabular-nums">{part}</strong>
          : part
      ))}
    </>
  );
}

// 만드는 동안 완성된 카드처럼 요약(왼쪽)·팁(오른쪽) 자리를 잡아 둔다
const SKELETON_COLUMNS = [
  { height: "h-5", widths: ["w-full", "w-11/12", "w-4/5", "w-2/3"] },
  { height: "h-4", widths: ["w-1/3", "w-full", "w-5/6", "w-full", "w-3/4"] },
];

function SummarySkeleton(): React.JSX.Element {
  return (
    <div aria-hidden="true" className="mt-6 grid gap-6 motion-safe:animate-pulse md:grid-cols-2 md:gap-8">
      {SKELETON_COLUMNS.map(({ height, widths }, column) => (
        <div key={column} className="space-y-3">
          {widths.map((width, line) => (
            <div key={line} className={`${height} ${width} rounded-full bg-primary/10`} />
          ))}
        </div>
      ))}
    </div>
  );
}

function FreeUpgradePrompt({ variant }: { variant: SummaryVariant }): React.JSX.Element {
  const message = variant === "month"
    ? "Pro에서는 확인할 지출 상세와 여러 달 추세까지 요약해요"
    : "Pro에서는 달라진 카테고리까지 요약해요";
  return (
    <>
      <p className="mt-4 text-sm text-body">{message}</p>
      <div className="mt-2">
        <UpgradeButton source="summary" label="Pro로 보기" variant="text" />
      </div>
    </>
  );
}

export function MonthlySummary({ summary, source, tips = [], upgrade, variant = "month" }: {
  summary: string;
  source: "ai" | "example";
  tips?: string[];
  upgrade?: boolean;
  variant?: SummaryVariant;
}): React.JSX.Element {
  return (
    <section className={CARD_CLASS}>
      <SummaryHeading variant={variant} />
      <div className={tips.length > 0 ? "mt-4 grid gap-6 md:grid-cols-2 md:gap-8" : "mt-4"}>
        <p className="whitespace-pre-line text-lg leading-relaxed text-ink">
          <EmphasizedNumbers text={summary} />
        </p>
        {tips.length > 0 && (
          <div>
            <h3 className="text-base font-semibold text-ink">이렇게 절약해 보세요</h3>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-base leading-relaxed text-ink">
              {tips.map((tip, index) => <li key={index}><EmphasizedNumbers text={tip} /></li>)}
            </ul>
          </div>
        )}
      </div>
      <p className="mt-3 text-caption text-body">
        {source === "ai"
          ? "AI가 가맹점명과 집계로 쓴 요약이에요. 금액은 코드로 계산해요."
          : "예시 요약이에요. 가입하면 AI가 내 가맹점명과 집계로 요약해요."}
      </p>
      {upgrade && <FreeUpgradePrompt variant={variant} />}
    </section>
  );
}

export function MonthlySummaryStatus({ state, upgrade, variant = "month" }: {
  state: "pending" | "failed";
  upgrade?: boolean;
  variant?: SummaryVariant;
}): React.JSX.Element {
  return (
    <section
      className={CARD_CLASS}
      {...(state === "pending" ? { "aria-busy": true } : {})}
    >
      <SummaryHeading variant={variant} />
      {state === "pending" ? (
        <>
          <div className="mt-4 flex items-center gap-2">
            <LoaderCircleIcon size={20} className="shrink-0 text-primary motion-safe:animate-spin" />
            <p className="text-base text-body">{variant === "statement" ? SUMMARY_STATUS_MESSAGES.statementPending : SUMMARY_STATUS_MESSAGES.pending}</p>
          </div>
          <SummarySkeleton />
        </>
      ) : (
        <p className="mt-4 text-base text-body">{SUMMARY_STATUS_MESSAGES.failed}</p>
      )}
      {upgrade && <FreeUpgradePrompt variant={variant} />}
    </section>
  );
}
