import { formatRatio, formatWon } from "@/lib/format";
import { CATEGORY_LABELS } from "@/types/category";
import type { CategoryAmount } from "@/types/dashboard";

const VISIBLE_COUNT = 5;

function CategoryRow({
  category,
  amount,
  ratio,
  maxAmount,
}: CategoryAmount & { maxAmount: number }): React.JSX.Element {
  return (
    <li className="border-b border-hairline-soft px-2 py-3">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-ink">{CATEGORY_LABELS[category]}</span>
        <div className="flex items-baseline gap-3">
          <span
            className={`text-right font-mono ${amount < 0 ? "text-body" : "text-ink"}`}
          >
            {formatWon(amount)}
          </span>
          {ratio !== null && (
            <span className="text-caption tabular-nums text-body">
              {formatRatio(ratio)}
            </span>
          )}
        </div>
      </div>
      {amount > 0 && (
        <div
          aria-hidden="true"
          className="mt-2 h-2 rounded-r-[4px] bg-primary"
          style={{ width: `${(amount / maxAmount) * 100}%` }}
        />
      )}
    </li>
  );
}

export function CategoryList({
  categories,
}: {
  categories: CategoryAmount[];
}): React.JSX.Element {
  const maxAmount = Math.max(0, ...categories.map(({ amount }) => amount));
  const visible = categories.slice(0, VISIBLE_COUNT);
  const folded = categories.slice(VISIBLE_COUNT);

  return (
    <section className="rounded-3xl border border-hairline bg-canvas p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-ink">카테고리</h2>
      <ul className="mt-4">
        {visible.map((row) => (
          <CategoryRow key={row.category} {...row} maxAmount={maxAmount} />
        ))}
      </ul>
      {folded.length > 0 && (
        <details className="group">
          <summary className="mt-3 inline-flex cursor-pointer items-center rounded-lg px-2 py-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            나머지 {folded.length}개 카테고리 보기
          </summary>
          <ul>
            {folded.map((row) => (
              <CategoryRow key={row.category} {...row} maxAmount={maxAmount} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
