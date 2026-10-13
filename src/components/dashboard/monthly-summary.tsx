import { SparklesIcon } from "@/components/icons";
import { UpgradeButton } from "@/components/billing/upgrade-button";
import { SUMMARY_STATUS_MESSAGES } from "@/lib/errors/messages";

function SummaryHeading(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <SparklesIcon size={20} className="shrink-0 text-primary" />
      <h2 className="text-lg font-semibold text-ink">이번 달 요약</h2>
    </div>
  );
}

function FreeUpgradePrompt(): React.JSX.Element {
  return (
    <>
      <p className="mt-4 text-sm text-body">Pro에서는 확인할 지출 상세와 여러 달 추세까지 요약해요</p>
      <div className="mt-2">
        <UpgradeButton source="summary" label="Pro로 보기" variant="text" />
      </div>
    </>
  );
}

export function MonthlySummary({ summary, source, upgrade }: {
  summary: string;
  source: "ai" | "example";
  upgrade?: boolean;
}): React.JSX.Element {
  return (
    <section className="rounded-3xl bg-primary-soft p-6 sm:p-8">
      <SummaryHeading />
      <p className="mt-4 whitespace-pre-line text-lg leading-relaxed text-ink">
        {summary}
      </p>
      <p className="mt-3 text-caption text-body">
        {source === "ai"
          ? "AI가 가맹점명과 집계로 쓴 요약이에요. 금액은 코드로 계산해요."
          : "예시 요약이에요. 가입하면 AI가 내 가맹점명과 집계로 요약해요."}
      </p>
      {upgrade && <FreeUpgradePrompt />}
    </section>
  );
}

export function MonthlySummaryStatus({ state, upgrade }: {
  state: "pending" | "failed";
  upgrade?: boolean;
}): React.JSX.Element {
  return (
    <section
      className="rounded-3xl bg-primary-soft p-6 sm:p-8"
      {...(state === "pending" ? { "aria-busy": true } : {})}
    >
      <SummaryHeading />
      <p className="mt-4 text-base text-body">{SUMMARY_STATUS_MESSAGES[state]}</p>
      {upgrade && <FreeUpgradePrompt />}
    </section>
  );
}
