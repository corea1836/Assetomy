import { FINDING_KIND_LABELS } from "@/components/dashboard/finding-labels";
import { formatWon } from "@/lib/format";
import type { Findings, Plan } from "@/types/dashboard";

export function PlanPreview({ plan, findings }: { plan: Plan; findings: Findings }): React.JSX.Element {
  const candidateCount = Object.values(findings.byKind).reduce((sum, { count }) => sum + count, 0);
  const items = plan === "pro" ? [...findings.items].sort((a, b) => b.amount - a.amount).slice(0, 2) : [];

  return (
    <div className="mb-8 min-w-0">
      <p className={`text-caption ${plan === "free" ? "text-body" : "text-muted-soft"}`}>
        이 플랜에서 보이는 것
      </p>
      <div className={`mt-3 rounded-2xl border p-4 ${plan === "free"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-hairline-dark bg-surface-dark-elevated text-amber-200"}`}>
        <p className="text-sm tabular-nums">
          {`확인이 필요한 지출 ${candidateCount}건 · 후보 합계 ${formatWon(findings.candidateTotal)}`}
        </p>
        {plan === "pro" && items.length > 0 && (
          <ul className="mt-3 space-y-3 border-t border-hairline-dark pt-3">
            {items.map(({ kind, merchantKey, merchant, amount }, index) => (
              <li key={`${kind}-${merchantKey}-${index}`} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 text-muted-soft">{`${FINDING_KIND_LABELS[kind]} · ${merchant}`}</span>
                <span className="text-right font-mono text-white">{formatWon(amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
