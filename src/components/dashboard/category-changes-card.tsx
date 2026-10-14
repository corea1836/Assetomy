import { formatSignedWon } from "@/lib/format";
import { CATEGORY_LABELS } from "@/types/category";
import type { CategoryChange } from "@/types/dashboard";

export function CategoryChangesCard(props: {
  changes: CategoryChange[];
  basis: "month" | "cycle";
}): React.JSX.Element | null {
  if (props.changes.length === 0) return null;
  return (
    <section className="min-w-0 rounded-3xl border border-hairline bg-canvas p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-ink">
        {props.basis === "month" ? "지난달과 달라진 카테고리" : "지난 명세서와 달라진 카테고리"}
      </h2>
      <ul className="mt-4">
        {props.changes.map(({ category, diff }) => (
          <li
            key={category}
            className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline-soft px-2 py-3 text-sm"
          >
            <span className="text-ink">{CATEGORY_LABELS[category]}</span>
            {diff > 0 ? (
              <span className="text-increase">
                <span className="font-mono">{formatSignedWon(diff)}</span> 늘었어요
              </span>
            ) : (
              <span className="text-decrease">
                <span className="font-mono">{formatSignedWon(diff)}</span> 줄었어요
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
