import { formatDate, formatPeriod, formatSignedWon, formatWon } from "@/lib/format";
import type { Period, PeriodSnapshot, StatementComparison } from "@/types/dashboard";

export function StatementTotalCard(props: {
  snapshot: PeriodSnapshot;
  cyclePeriod: Period;
  complete: boolean;
  comparison: StatementComparison | null;
  comparisonSkipped: boolean;
}): React.JSX.Element {
  const comparison = props.comparison;
  return (
    <section className="flex flex-col rounded-3xl border border-hairline bg-canvas p-6 sm:p-8">
      <h2 className="text-sm text-body">총지출</h2>
      <p className="mt-3 font-mono text-3xl font-medium text-ink">{formatWon(props.snapshot.total)}</p>
      {props.comparisonSkipped ? (
        <p className="mt-3 text-sm text-body">이용 기간이 끝나기 전에 받은 명세서가 있어 지난 명세서와 비교하지 않았어요</p>
      ) : comparison !== null ? (
        <p className="mt-3 text-sm tabular-nums text-body">
          {comparison.diff === 0 ? (
            `${formatDate(comparison.previousStatementDate)} 명세서와 같아요`
          ) : (
            <>
              {formatDate(comparison.previousStatementDate)} 명세서보다{" "}
              {comparison.diff > 0 ? (
                <span className="text-increase">
                  <span className="font-mono">{formatSignedWon(comparison.diff)}</span> 늘었어요
                </span>
              ) : (
                <span className="text-decrease">
                  <span className="font-mono">{formatSignedWon(comparison.diff)}</span> 줄었어요
                </span>
              )}
            </>
          )}
        </p>
      ) : null}
      <div className="mt-auto pt-6">
        <div className="border-t border-hairline-soft pt-4">
          <p className="text-caption tabular-nums text-body">
            거래 {props.snapshot.transactionCount}건 · 반영 기간 {formatPeriod(props.snapshot.period)}
          </p>
          <p className="mt-1 text-caption tabular-nums text-body">이용 기간 {formatPeriod(props.cyclePeriod)}</p>
          <p className="mt-1 text-caption text-body">취소·환불은 카드사 파일의 날짜 기준으로 반영돼요</p>
          {!props.complete && (
            <p className="mt-1 text-caption text-body">이용 기간이 끝나기 전에 받은 명세서예요. 그 뒤 거래는 빠져 있을 수 있어요</p>
          )}
        </div>
      </div>
    </section>
  );
}
