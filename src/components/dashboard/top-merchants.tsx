import { formatTransactionCount, formatWon } from "@/lib/format";
import { CATEGORY_LABELS } from "@/types/category";
import type { MerchantAmount } from "@/types/dashboard";
import { MerchantCategorySelect } from "./merchant-category-select";

function MerchantRow({ merchantKey, merchant, category, count, cancelCount, amount, editable }: MerchantAmount & {
  editable?: boolean;
}): React.JSX.Element {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-hairline-soft px-2 py-3">
      <div className="min-w-0 flex-1">
        <p title={merchant} className="truncate text-sm text-ink">{merchant}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-caption tabular-nums text-body">
          {editable ? (
            <>
              <MerchantCategorySelect merchantKey={merchantKey} merchant={merchant} category={category} />
              <span>{formatTransactionCount(count, cancelCount)}</span>
            </>
          ) : `${CATEGORY_LABELS[category]} · ${formatTransactionCount(count, cancelCount)}`}
        </div>
      </div>
      <span className={`shrink-0 text-right font-mono text-sm ${amount < 0 ? "text-body" : "text-ink"}`}>
        {formatWon(amount)}
      </span>
    </li>
  );
}

export function TopMerchants({
  merchants,
  otherMerchants,
  editable,
}: {
  merchants: MerchantAmount[];
  otherMerchants: MerchantAmount[];
  editable?: boolean;
}): React.JSX.Element {
  return (
    <section className="rounded-3xl border border-hairline bg-canvas p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-ink">가장 많이 쓴 곳</h2>
      <ul className="mt-4">
        {merchants.map((row) => <MerchantRow key={row.merchantKey} {...row} editable={editable} />)}
      </ul>
      {otherMerchants.length > 0 && (
        <details className="group">
          <summary className="mt-3 inline-flex cursor-pointer items-center rounded-lg px-2 py-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            나머지 {otherMerchants.length}곳 보기
          </summary>
          <ul>
            {otherMerchants.map((row) => <MerchantRow key={row.merchantKey} {...row} editable={editable} />)}
          </ul>
        </details>
      )}
      {editable && (
        <p className="mt-4 text-caption text-body">카테고리를 바꾸면 같은 가맹점의 모든 거래에 적용돼요</p>
      )}
    </section>
  );
}
