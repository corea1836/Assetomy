import {
  formatMonthShort,
  formatPeriod,
  formatSignedWon,
  formatWon,
} from "@/lib/format";
import type { MonthOverMonth, Snapshot } from "@/types/dashboard";
import type { YearMonth } from "@/types/transaction";

export function TotalCard({
  snapshot,
  mom,
  partialMonth = null,
}: {
  snapshot: Snapshot;
  mom: MonthOverMonth | null;
  partialMonth?: YearMonth | null;
}): React.JSX.Element {
  return (
    <section className="flex flex-col rounded-3xl border border-hairline bg-canvas p-6 sm:p-8">
      <h2 className="text-sm text-body">총지출</h2>
      <p className="mt-3 font-mono text-3xl font-medium text-ink">
        {formatWon(snapshot.total)}
      </p>
      {mom !== null && (
        <p className="mt-3 text-sm tabular-nums text-body">
          {mom.diff === 0 ? (
            `${formatMonthShort(mom.previousMonth)}과 같아요`
          ) : (
            <>
              {formatMonthShort(mom.previousMonth)}보다{" "}
              {mom.diff > 0 ? (
                <span className="text-increase">
                  <span className="font-mono">{formatSignedWon(mom.diff)}</span> 늘었어요
                </span>
              ) : (
                <span className="text-decrease">
                  <span className="font-mono">{formatSignedWon(mom.diff)}</span> 줄었어요
                </span>
              )}
            </>
          )}
        </p>
      )}
      {mom === null && partialMonth !== null && (
        <p className="mt-3 text-sm text-body">
          {`${formatMonthShort(partialMonth)} 내역이 일부만 있어 지난달과 비교하지 않았어요`}
        </p>
      )}
      {/* 카드가 옆 카드 높이로 늘어나면 근거 줄을 아래로 붙인다 */}
      <div className="mt-auto pt-6">
        <div className="border-t border-hairline-soft pt-4">
          <p className="text-caption tabular-nums text-body">
            {`거래 ${snapshot.transactionCount}건${snapshot.cancelCount > 0 ? ` · 취소 ${snapshot.cancelCount}건` : ""} · 반영 기간 ${formatPeriod(snapshot.period)}`}
          </p>
          <p className="mt-1 text-caption text-body">
            취소·환불은 카드사 파일의 날짜 기준으로 반영돼요
          </p>
          {snapshot.inProgress && (
            <p className="mt-1 text-caption text-body">진행 중인 달이에요</p>
          )}
        </div>
      </div>
    </section>
  );
}
