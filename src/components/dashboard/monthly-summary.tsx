import { SparklesIcon } from "@/components/icons";

export function MonthlySummary({
  summary,
  source,
}: {
  summary: string;
  source: "ai" | "example";
}): React.JSX.Element {
  return (
    <section className="rounded-3xl bg-primary-soft p-6 sm:p-8">
      <div className="flex items-center gap-2">
        <SparklesIcon size={20} className="shrink-0 text-primary" />
        <h2 className="text-lg font-semibold text-ink">이번 달 요약</h2>
      </div>
      <p className="mt-4 whitespace-pre-line text-lg leading-relaxed text-ink">
        {summary}
      </p>
      <p className="mt-3 text-caption text-body">
        {source === "ai"
          ? "AI가 가맹점명과 집계로 쓴 요약이에요. 금액은 코드로 계산해요."
          : "예시 요약이에요. 가입하면 AI가 내 가맹점명과 집계로 요약해요."}
      </p>
    </section>
  );
}
