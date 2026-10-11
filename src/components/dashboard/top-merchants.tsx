import { formatWon } from "@/lib/format";
import { CATEGORY_LABELS } from "@/types/category";
import type { MerchantAmount } from "@/types/dashboard";

export function TopMerchants({
  merchants,
}: {
  merchants: MerchantAmount[];
}): React.JSX.Element {
  return (
    <section className="rounded-3xl border border-hairline bg-canvas p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-ink">가장 많이 쓴 곳</h2>
      <ul className="mt-4">
        {merchants.map(({ merchantKey, merchant, category, count, amount }) => (
          <li
            key={merchantKey}
            className="flex items-center justify-between gap-4 border-b border-hairline-soft px-2 py-3"
          >
            <div className="min-w-0">
              <p title={merchant} className="truncate text-sm text-ink">
                {merchant}
              </p>
              <p className="mt-1 text-caption tabular-nums text-body">
                {CATEGORY_LABELS[category]} · {count}건
              </p>
            </div>
            <span
              className={`shrink-0 text-right font-mono text-sm ${amount < 0 ? "text-body" : "text-ink"}`}
            >
              {formatWon(amount)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
