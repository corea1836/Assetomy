import { formatRatio, formatWon } from "@/lib/format";
import { CATEGORY_LABELS } from "@/types/category";
import type { CategoryAmount } from "@/types/dashboard";

const VISIBLE_COUNT = 5;

type SliceColor = { dot: string; arc: string };

// 금액 순위별 색(DESIGN "차트"). 나머지는 회색 "그 밖" 한 조각으로 묶는다.
const RANK_COLORS: SliceColor[] = [
  { dot: "bg-category-1", arc: "stroke-category-1" },
  { dot: "bg-category-2", arc: "stroke-category-2" },
  { dot: "bg-category-3", arc: "stroke-category-3" },
  { dot: "bg-category-4", arc: "stroke-category-4" },
  { dot: "bg-category-5", arc: "stroke-category-5" },
];
const OTHER_COLOR: SliceColor = { dot: "bg-category-other", arc: "stroke-category-other" };

const RADIUS = 84;
const STROKE_WIDTH = 24;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 2; // 조각 사이 흰 틈

type Slice = { key: string; label: string; amount: number; ratio: number | null; color: SliceColor };

function ratioText(ratio: number | null): string {
  return ratio === null ? "" : ` ${formatRatio(ratio)}`;
}

function CategoryRow({ slice: { label, amount, ratio, color } }: { slice: Slice }): React.JSX.Element {
  return (
    <li className="border-b border-hairline-soft px-2 py-3">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="inline-flex items-center gap-2 text-ink">
          {amount > 0 && (
            <span data-slice-dot aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${color.dot}`} />
          )}
          {label}
        </span>
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
    </li>
  );
}

function Donut({ slices, total }: { slices: Slice[]; total: number }): React.JSX.Element {
  const positive = slices.filter(({ amount }) => amount > 0);
  const sum = positive.reduce((acc, { amount }) => acc + amount, 0);
  const gap = positive.length > 1 ? GAP : 0;
  const arcs = positive.map((slice, index) => {
    const start = positive.slice(0, index).reduce((acc, { amount }) => acc + amount, 0);
    return {
      slice,
      offset: (start / sum) * CIRCUMFERENCE,
      length: (slice.amount / sum) * CIRCUMFERENCE - gap,
    };
  });

  return (
    <div role="img" aria-label="카테고리 비중 도넛 차트" className="relative mx-auto mt-4 size-44">
      <svg viewBox="0 0 200 200" className="size-full">
        <g transform="rotate(-90 100 100)">
          {arcs.filter(({ length }) => length > 0).map(({ slice, offset, length }) => (
            <circle
              key={slice.key}
              cx={100}
              cy={100}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE_WIDTH}
              strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
              strokeDashoffset={-offset}
              className={slice.color.arc}
            >
              <title>{`${slice.label} ${formatWon(slice.amount)}${ratioText(slice.ratio)}`}</title>
            </circle>
          ))}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-caption text-body">총지출</span>
        <span className="font-mono text-base font-semibold text-ink">{formatWon(total)}</span>
      </div>
    </div>
  );
}

export function CategoryList({
  categories,
  total,
}: {
  categories: CategoryAmount[];
  total: number;
}): React.JSX.Element {
  const toSlice = ({ category, amount, ratio }: CategoryAmount, color: SliceColor): Slice => (
    { key: category, label: CATEGORY_LABELS[category], amount, ratio, color }
  );
  const visible = categories.slice(0, VISIBLE_COUNT).map((row, index) => toSlice(row, RANK_COLORS[index]));
  const folded = categories.slice(VISIBLE_COUNT).map((row) => toSlice(row, OTHER_COLOR));
  const otherAmount = folded.reduce((acc, { amount }) => acc + amount, 0);
  const slices: Slice[] = folded.length === 0 ? visible : [
    ...visible,
    { key: "other", label: "그 밖", amount: otherAmount, ratio: total > 0 ? otherAmount / total : null, color: OTHER_COLOR },
  ];

  return (
    <section className="rounded-3xl border border-hairline bg-canvas p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-ink">카테고리</h2>
      {total > 0 && <Donut slices={slices} total={total} />}
      <ul className="mt-4">
        {slices.map((slice) => <CategoryRow key={slice.key} slice={slice} />)}
      </ul>
      {folded.length > 0 && (
        <details className="group">
          <summary className="mt-3 inline-flex cursor-pointer items-center rounded-lg px-2 py-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            나머지 {folded.length}개 카테고리 보기
          </summary>
          <ul>
            {folded.map((slice) => <CategoryRow key={slice.key} slice={slice} />)}
          </ul>
        </details>
      )}
    </section>
  );
}
