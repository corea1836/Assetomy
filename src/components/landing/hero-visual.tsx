import { FINDING_KIND_LABELS } from "@/components/dashboard/finding-labels";
import { formatDate, formatMonth, formatWon } from "@/lib/format";
import { CATEGORY_LABELS } from "@/types/category";
import type { Findings, Snapshot } from "@/types/dashboard";
import type { YearMonth } from "@/types/transaction";

export function HeroVisual({
  month,
  cardLabels,
  snapshot,
  findings,
}: {
  month: YearMonth;
  cardLabels: string[];
  snapshot: Snapshot;
  findings: Findings;
}): React.JSX.Element {
  const categories = snapshot.categories.slice(0, 3);
  const maxCategoryAmount = Math.max(0, ...categories.map(({ amount }) => amount));
  const maxDailyAmount = Math.max(0, ...snapshot.daily.map(({ amount }) => amount));
  const largestDay = snapshot.daily.find(({ amount }) => amount === maxDailyAmount && amount > 0);
  const candidateCount = Object.values(findings.byKind)
    .reduce((sum, { count }) => sum + count, 0);
  const duplicate = findings.items.find(({ kind }) => kind === "duplicate");
  const firstDuplicateTransaction = duplicate?.transactions[0];
  const extensions = [".xlsx", ".csv"];

  return (
    <div className="relative min-w-0 space-y-4 lg:space-y-0 lg:pb-8 lg:pt-52">
      <div className="relative z-10 flex flex-wrap gap-3 lg:absolute lg:inset-x-0 lg:top-0">
        {cardLabels.slice(0, 2).map((label, index) => (
          <span
            key={`${label}-${index}`}
            className="min-w-0 max-w-full break-words rounded-full border border-hairline-dark bg-surface-dark-elevated px-4 py-2 text-sm text-muted-soft"
          >
            {`${label}${extensions[index]}`}
          </span>
        ))}
      </div>

      <svg
        aria-hidden="true"
        viewBox="0 0 460 208"
        preserveAspectRatio="none"
        fill="none"
        stroke="var(--color-hairline-dark)"
        strokeWidth={1}
        className="pointer-events-none absolute inset-x-0 top-0 hidden h-52 w-full lg:block"
      >
        <path d="M96 40V168Q96 192 120 192H136V208" vectorEffect="non-scaling-stroke" />
        <path d="M310 40V48H30Q14 48 14 64V184Q14 208 38 208H64" vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="absolute right-0 top-12 hidden w-4/5 rounded-3xl border border-hairline-dark bg-surface-dark-elevated p-6 lg:block">
        <p className="text-sm tabular-nums text-muted-soft">
          {`${formatMonth(month)} 일별 지출`}
        </p>
        <div
          role="img"
          aria-label={`${formatMonth(month)} 일별 지출 막대(예시)`}
          className="mt-4 flex h-24 items-end gap-1"
        >
          {snapshot.daily.map(({ date, amount }) => (
            <div
              key={date}
              aria-hidden="true"
              className={`max-w-6 min-w-0 flex-1 rounded-t-[4px] ${date === largestDay?.date ? "bg-primary-on-dark" : "bg-primary-on-dark/40"}`}
              style={{ height: `${maxDailyAmount > 0 ? (Math.max(0, amount) / maxDailyAmount) * 100 : 0}%` }}
            />
          ))}
        </div>
        <ul className="sr-only" aria-label="예시 일별 지출 금액">
          {snapshot.daily.map(({ date, amount }) => (
            <li key={date}>{`${formatDate(date)} · ${formatWon(amount)}`}</li>
          ))}
        </ul>
      </div>

      <div className="relative z-10 min-w-0 rounded-3xl border border-hairline-dark bg-surface-dark-raised p-8 shadow-float lg:mr-8">
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
                  className="mt-2 h-2 rounded-r-[4px] bg-primary-on-dark"
                  style={{ width: `${(amount / maxCategoryAmount) * 100}%` }}
                />
              )}
            </li>
          ))}
        </ul>
        <div className="mt-6 rounded-2xl border border-hairline-dark bg-surface-dark px-4 py-3">
          <p className="text-sm tabular-nums text-amber-200">
            {`확인이 필요한 지출 ${candidateCount}건 · 후보 합계 ${formatWon(findings.candidateTotal)}`}
          </p>
        </div>
        <p className="mt-3 text-caption text-muted-soft">예시 데이터</p>
      </div>

      {duplicate && firstDuplicateTransaction && (
        <p className="relative z-20 min-w-0 rounded-2xl border border-hairline-dark bg-surface-dark-raised px-4 py-3 text-sm tabular-nums text-amber-200 shadow-float lg:absolute lg:bottom-0 lg:right-0 lg:max-w-full">
          {`${FINDING_KIND_LABELS.duplicate} · ${formatDate(firstDuplicateTransaction.date)} ${formatWon(firstDuplicateTransaction.amount)} × ${duplicate.transactions.length}`}
        </p>
      )}
    </div>
  );
}
