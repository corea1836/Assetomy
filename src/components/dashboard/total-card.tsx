import {
  formatMonthShort,
  formatPeriod,
  formatSignedWon,
  formatWon,
} from "@/lib/format";
import type { MonthOverMonth, Snapshot } from "@/types/dashboard";

export function TotalCard({
  snapshot,
  mom,
}: {
  snapshot: Snapshot;
  mom: MonthOverMonth | null;
}): React.JSX.Element {
  return (
    <section className="rounded-3xl border border-hairline bg-canvas p-6 sm:p-8">
      <h2 className="text-sm text-body">총지출</h2>
      <p className="mt-3 font-mono text-3xl font-medium text-ink">
        {formatWon(snapshot.total)}
      </p>
      <p className="mt-3 text-caption tabular-nums text-body">
        거래 {snapshot.transactionCount}건 · 반영 기간 {formatPeriod(snapshot.period)}
      </p>
      <p className="mt-2 text-caption text-body">
        취소·환불은 카드사 파일의 날짜 기준으로 반영돼요
      </p>
      {mom !== null && (
        <p className="mt-4 text-sm tabular-nums text-body">
          {formatMonthShort(mom.previousMonth)}보다{" "}
          {mom.diff > 0 ? (
            <span className="text-increase">
              <span className="font-mono">{formatSignedWon(mom.diff)}</span> 늘었어요
            </span>
          ) : mom.diff < 0 ? (
            <span className="text-decrease">
              <span className="font-mono">{formatSignedWon(mom.diff)}</span> 줄었어요
            </span>
          ) : (
            <span className="text-body">같아요</span>
          )}
        </p>
      )}
      {snapshot.inProgress && (
        <p className="mt-2 text-caption text-body">진행 중인 달이에요</p>
      )}
    </section>
  );
}
