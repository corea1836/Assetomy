import { FINDING_KIND_LABELS } from "@/components/dashboard/finding-labels";
import { MonthlySummary } from "@/components/dashboard/monthly-summary";
import { DarkBackdrop } from "@/components/landing/dark-backdrop";
import { formatDate, formatMonth, formatMonthShort, formatSignedWon, formatWon } from "@/lib/format";
import type { FindingKind, Findings, MonthOverMonth, Trend } from "@/types/dashboard";
import type { YearMonth } from "@/types/transaction";

export function SummaryBand({
  month,
  summary,
  findings,
  trend,
  mom,
}: {
  month: YearMonth;
  summary: string;
  findings: Findings;
  trend: Trend | null;
  mom: MonthOverMonth | null;
}): React.JSX.Element {
  const large = findings.items.filter(({ kind }) => kind === "large")
    .sort((a, b) => b.amount - a.amount)[0];
  const largeTransaction = large?.transactions[0];
  const recurring = findings.items.filter(({ kind }) => kind === "recurring");
  const duplicate = findings.items.find(({ kind }) => kind === "duplicate");
  const duplicateTransaction = duplicate?.transactions[0];
  const evidence: { kind: FindingKind; description: string; amount: string }[] = [];

  if (large && largeTransaction) {
    evidence.push({
      kind: "large",
      description: `${formatDate(largeTransaction.date)} ${large.merchant}`,
      amount: formatWon(large.amount),
    });
  }
  if (recurring.length > 0) {
    evidence.push({
      kind: "recurring",
      description: recurring.map(({ merchant }) => merchant).join(" · "),
      amount: `${findings.byKind.recurring.count}건 · ${formatWon(findings.byKind.recurring.amount)}`,
    });
  }
  if (duplicate && duplicateTransaction) {
    evidence.push({
      kind: "duplicate",
      description: `${formatDate(duplicateTransaction.date)} ${duplicate.merchant}`,
      amount: `${formatWon(duplicateTransaction.amount)} × ${duplicate.transactions.length}`,
    });
  }

  const numbers = ["①", "②", "③"];
  const maxMonthlyAmount = Math.max(0, ...(trend?.months.map(({ total }) => total) ?? []));
  const momSentence = mom === null ? null : mom.diff === 0
    ? `${formatMonthShort(mom.previousMonth)}과 같아요`
    : `${formatMonthShort(mom.previousMonth)}보다 ${formatSignedWon(mom.diff)} ${mom.diff > 0 ? "늘었어요" : "줄었어요"}`;

  return (
    <section className="relative isolate overflow-hidden bg-surface-dark text-white">
      <DarkBackdrop light="right" />
      <div className="mx-auto max-w-[1248px] px-6 py-24">
        <div className="reveal">
          <h2 className="text-display-sm font-normal">
            숫자는 코드가 계산하고, 요약은 문장으로 정리해요
          </h2>
          <p className="mt-4 text-lg text-muted-soft">
            매달 집계를 읽고 달라진 점과 확인할 지출을 한 문단으로 정리해요.
          </p>
        </div>

        <div className="mt-10 grid min-w-0 items-start gap-8 lg:grid-cols-2 lg:gap-16">
          <div className="reveal min-w-0">
            <MonthlySummary summary={summary} source="example" />
          </div>
          <ol aria-label="요약의 근거" className="reveal min-w-0 space-y-4">
            {evidence.map(({ kind, description, amount }, index) => (
              <li key={kind} className="rounded-3xl border border-hairline-dark bg-surface-dark-elevated p-6">
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="text-primary-on-dark">{numbers[index]}</span>
                  <p className="text-sm text-amber-200">{FINDING_KIND_LABELS[kind]}</p>
                </div>
                <p className="mt-3 text-sm tabular-nums text-muted-soft">{description}</p>
                <p className="mt-3 text-right font-mono text-white">{amount}</p>
              </li>
            ))}
          </ol>
        </div>

        {(trend || mom) && (
          <div className="reveal mt-12 grid min-w-0 items-end gap-8 lg:grid-cols-[2fr_1fr]">
            {trend && (
              <div className="min-w-0">
                <div role="img" aria-label="월별 지출 추세 막대(예시)" className="flex gap-4 pt-6">
                  {trend.months.map(({ month: trendMonth, total }) => (
                    <div key={trendMonth} aria-hidden="true" className="flex min-w-0 flex-1 flex-col items-center gap-3">
                      <div className="flex h-32 w-full items-end justify-center">
                        <div
                          className={`relative w-full max-w-6 rounded-t-[4px] ${trendMonth === month ? "bg-primary-on-dark" : "bg-primary-on-dark/40"}`}
                          style={{ height: `${maxMonthlyAmount > 0 ? (Math.max(0, total) / maxMonthlyAmount) * 100 : 0}%` }}
                        >
                          {largeTransaction && trendMonth === month && (
                            <span aria-hidden="true" className="absolute -top-6 left-1/2 -translate-x-1/2 text-primary-on-dark">
                              ①
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="font-mono text-caption text-muted-soft">{formatMonthShort(trendMonth)}</span>
                    </div>
                  ))}
                </div>
                <ul aria-label="예시 월별 지출 금액" className="sr-only">
                  {trend.months.map(({ month: trendMonth, total }) => (
                    <li key={trendMonth}>{`${formatMonth(trendMonth)} · ${formatWon(total)}`}</li>
                  ))}
                </ul>
              </div>
            )}
            {momSentence && <p className="text-lg tabular-nums text-white">{momSentence}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
