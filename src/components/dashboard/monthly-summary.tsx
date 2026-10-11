export function MonthlySummary({
  summary,
}: {
  summary: string;
}): React.JSX.Element {
  return (
    <section className="rounded-3xl border border-hairline bg-canvas p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-ink">이번 달 요약</h2>
      <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-body">
        {summary}
      </p>
    </section>
  );
}
