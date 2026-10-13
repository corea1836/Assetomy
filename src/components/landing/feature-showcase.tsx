import { FINDING_KIND_LABELS } from "@/components/dashboard/finding-labels";
import { CardIcon, CheckIcon, SearchIcon, ShieldCheckIcon, XIcon } from "@/components/icons";
import { formatDate, formatMonthShort, formatWon } from "@/lib/format";
import type { Findings, Snapshot } from "@/types/dashboard";
import type { YearMonth } from "@/types/transaction";

export function FeatureShowcase({
  month,
  dataMonths,
  cardLabels,
  snapshot,
  findings,
}: {
  month: YearMonth;
  dataMonths: YearMonth[];
  cardLabels: string[];
  snapshot: Snapshot;
  findings: Findings;
}): React.JSX.Element {
  const months = [...dataMonths].sort();
  const recurring = findings.items.filter((item) => item.kind === "recurring");
  const duplicate = findings.items.find(({ kind }) => kind === "duplicate");
  const large = findings.items.find(({ kind }) => kind === "large");
  const largeTransaction = large?.transactions[0];
  const maxDailyAmount = Math.max(0, ...snapshot.daily.map(({ amount }) => amount));

  return (
    <div className="mt-10 space-y-16">
      <article className="reveal grid min-w-0 items-start gap-8 lg:grid-cols-2 lg:gap-16">
        <div className="min-w-0">
          <CardIcon size={24} className="text-primary" />
          <h3 className="mt-5 text-title-lg font-normal text-ink">한 화면에 모든 카드</h3>
          <p className="mt-4 text-lg leading-relaxed text-body">
            카드사마다 받은 이용내역 파일을 올리면 카드별로 나눠 합산해요.
          </p>
        </div>
        <div className="min-w-0 rounded-3xl bg-surface-soft p-6 sm:p-8">
          {/* 칩을 같은 폭 칸 가운데에 두어 아래 연결선이 칩 가운데에서 내려오게 한다 */}
          <ul
            aria-label="예시 카드"
            className="grid justify-items-center"
            style={{ gridTemplateColumns: `repeat(${cardLabels.length}, minmax(0, 1fr))` }}
          >
            {cardLabels.map((label) => (
              <li
                key={label}
                className="min-w-0 max-w-full break-words rounded-full border border-hairline bg-canvas px-4 py-2 text-sm text-ink"
              >
                {label}
              </li>
            ))}
          </ul>
          <svg
            aria-hidden="true"
            viewBox="0 0 240 32"
            preserveAspectRatio="none"
            fill="none"
            stroke="var(--color-hairline)"
            strokeWidth={1}
            className="pointer-events-none h-8 w-full"
          >
            {cardLabels.map((label, index) => (
              <path
                key={label}
                d={`M${((index + 0.5) / cardLabels.length) * 240} 0V16H120V32`}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <p className="rounded-2xl border border-hairline bg-canvas p-4 text-base font-semibold tabular-nums text-ink">
            {`${formatMonthShort(month)} 총지출 ${formatWon(snapshot.total)} · 거래 ${snapshot.transactionCount}건`}
          </p>
        </div>
      </article>

      <article className="reveal grid min-w-0 items-start gap-8 lg:grid-cols-2 lg:gap-16">
        <div className="min-w-0 lg:order-2">
          <SearchIcon size={24} className="text-primary" />
          <h3 className="mt-5 text-title-lg font-normal text-ink">확인이 필요한 지출</h3>
          <p className="mt-4 text-lg leading-relaxed text-body">
            정기결제로 보이는 결제, 중복 결제 의심, 평소보다 큰 결제를 찾아드려요. 정상 지출일 수도 있어요.
          </p>
        </div>
        <div className="min-w-0 rounded-3xl bg-surface-soft p-6 sm:p-8 lg:order-1">
          <div className="space-y-4">
            {recurring.length > 0 && (
              <section
                aria-label={FINDING_KIND_LABELS.recurring}
                className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900"
              >
                <h4 className="text-sm font-semibold">{FINDING_KIND_LABELS.recurring}</h4>
                <ul className="mt-3 space-y-4">
                  {recurring.map((item) => {
                    const seriesMonths = [...item.seriesMonths].sort();
                    return (
                      <li key={item.merchantKey}>
                        <p className="text-sm tabular-nums">
                          {`${item.merchant} · ${formatWon(item.amount)}`}
                        </p>
                        <div aria-hidden="true" className="mt-3 flex gap-2">
                          {months.map((dataMonth) => (
                            <span key={dataMonth} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                              <span className="font-mono text-caption text-body">
                                {formatMonthShort(dataMonth)}
                              </span>
                              <span className="flex h-3 items-center">
                                {seriesMonths.includes(dataMonth) && (
                                  <span className="size-2 rounded-full bg-primary" />
                                )}
                              </span>
                            </span>
                          ))}
                        </div>
                        {seriesMonths.length > 0 && (
                          <p className="mt-2 text-caption tabular-nums text-body">
                            {`${formatMonthShort(seriesMonths[0])}~${formatMonthShort(seriesMonths[seriesMonths.length - 1])} 매달 결제`}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {duplicate && (
              <section
                aria-label={FINDING_KIND_LABELS.duplicate}
                className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900"
              >
                <h4 className="text-sm font-semibold">{FINDING_KIND_LABELS.duplicate}</h4>
                <p className="mt-3 text-sm">{duplicate.merchant}</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {duplicate.transactions.map(({ id, date, amount }) => (
                    <li key={id} className="min-w-0 rounded-xl border border-amber-200 bg-canvas px-3 py-2 text-sm tabular-nums">
                      {`${formatDate(date)} · ${formatWon(amount)}`}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {large && largeTransaction && (
              <section
                aria-label={FINDING_KIND_LABELS.large}
                className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900"
              >
                <h4 className="text-sm font-semibold">{FINDING_KIND_LABELS.large}</h4>
                <div aria-hidden="true" className="mt-4 flex h-24 items-end gap-1">
                  {snapshot.daily.map(({ date, amount }) => (
                    <div
                      key={date}
                      className={`max-w-6 min-w-0 flex-1 rounded-t-[4px] ${date === largeTransaction.date ? "bg-primary" : "bg-primary/40"}`}
                      style={{ height: `${maxDailyAmount > 0 ? (Math.max(0, amount) / maxDailyAmount) * 100 : 0}%` }}
                    />
                  ))}
                </div>
                <p className="mt-3 text-sm tabular-nums">
                  {`${formatDate(largeTransaction.date)} ${large.merchant} ${formatWon(large.amount)}`}
                </p>
              </section>
            )}
          </div>
          <p className="mt-4 text-caption text-body">정상 지출일 수 있어요</p>
        </div>
      </article>

      <article className="reveal grid min-w-0 items-start gap-8 lg:grid-cols-2 lg:gap-16">
        <div className="min-w-0">
          <ShieldCheckIcon size={24} className="text-primary" />
          <h3 className="mt-5 text-title-lg font-normal text-ink">연동 없이, 언제든 삭제</h3>
          <p className="mt-4 text-lg leading-relaxed text-body">
            계좌나 카드사에 연동하지 않아요. 원본 파일은 암호화해 보관하고, 원할 때 바로 지울 수 있어요.
          </p>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-4 rounded-3xl bg-surface-soft p-6 sm:gap-6 sm:p-8">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-ink">받는 것</h4>
            <p className="mt-4 flex items-start gap-2 text-sm text-body">
              <CheckIcon className="shrink-0 text-primary" />
              <span>카드사에서 받은 이용내역 파일</span>
            </p>
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-ink">받지 않는 것</h4>
            <ul className="mt-4 space-y-3 text-sm text-body">
              {["카드번호", "계좌", "카드사 비밀번호"].map((label) => (
                <li key={label} className="flex items-start gap-2">
                  <XIcon className="shrink-0 text-body" />
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </article>
    </div>
  );
}
