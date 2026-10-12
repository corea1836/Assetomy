import { FINDING_KIND_LABELS } from "@/components/dashboard/finding-labels";
import { formatDate, formatMonthShort, formatWon } from "@/lib/format";
import { CATEGORY_LABELS } from "@/types/category";
import type { FindingKind, Findings } from "@/types/dashboard";

const FINDING_KINDS: FindingKind[] = ["recurring", "duplicate", "large"];

export function FindingsList({
  findings,
  dataMonthCount,
}: {
  findings: Findings;
  dataMonthCount: number;
}): React.JSX.Element {
  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold text-ink">확인이 필요한 지출</h2>
      {findings.items.length === 0 ? (
        <p className="text-base text-body">
          이번 규칙으로 확인할 지출 후보가 발견되지 않았어요
        </p>
      ) : (
        <>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900 sm:p-8">
            <ul aria-label="탐지 종류별 요약" className="space-y-3">
              {FINDING_KINDS.map((kind) => (
                <li
                  key={kind}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                >
                  <span>{FINDING_KIND_LABELS[kind]}</span>
                  <span className="text-right font-mono">
                    {findings.byKind[kind].count}건 ·{" "}
                    {formatWon(findings.byKind[kind].amount)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-base font-semibold">
              후보 합계{" "}
              <span className="font-mono">{formatWon(findings.candidateTotal)}</span>
            </p>
            <p className="mt-2 text-caption text-body">
              같은 거래는 한 번만 셌어요. 정상 지출일 수 있어요.
            </p>
          </div>
          <div className="rounded-3xl border border-hairline bg-canvas p-6 sm:p-8">
            <ul aria-label="확인할 지출 상세">
              {findings.items.map((finding, index) => (
                <li
                  key={`${finding.kind}-${finding.merchantKey}-${index}`}
                  className="border-b border-hairline-soft px-2 py-3"
                >
                  <p className="text-sm text-body">{FINDING_KIND_LABELS[finding.kind]}</p>
                  <div className="mt-2 flex items-baseline justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="break-words text-base font-semibold text-ink">
                        {finding.merchant}
                      </h3>
                      <p className="mt-1 text-caption text-body">
                        {CATEGORY_LABELS[finding.category]}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-right font-mono text-sm ${finding.amount < 0 ? "text-body" : "text-ink"}`}
                    >
                      {formatWon(finding.amount)}
                    </span>
                  </div>
                  {finding.kind === "recurring" && (
                    <p className="mt-3 text-caption tabular-nums text-body">
                      {finding.seriesMonths.map(formatMonthShort).join(" · ")} 결제
                    </p>
                  )}
                  <ul className="mt-3">
                    {finding.transactions.map((transaction) => (
                      <li
                        key={transaction.id}
                        className="flex items-baseline justify-between gap-4 border-b border-hairline-soft px-2 py-3"
                      >
                        <p className="min-w-0 break-words text-caption tabular-nums text-body">
                          {formatDate(transaction.date)} · {transaction.cardLabel}
                        </p>
                        <span
                          className={`shrink-0 text-right font-mono text-sm ${transaction.amount < 0 ? "text-body" : "text-ink"}`}
                        >
                          {formatWon(transaction.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      {dataMonthCount < 2 && (
        <p className="text-caption text-body">
          한 달치만 더 올리면 정기결제를 찾아드려요
        </p>
      )}
    </section>
  );
}
