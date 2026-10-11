"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatAxisWon,
  formatMonth,
  formatMonthShort,
  formatSignedWon,
  formatWon,
} from "@/lib/format";
import { CATEGORY_LABELS } from "@/types/category";
import type { Trend } from "@/types/dashboard";

const axisTick = {
  fill: "var(--color-body)",
  fontSize: 12,
  className: "font-mono",
};

export function TrendChart({ trend }: { trend: Trend }): React.JSX.Element {
  return (
    <section className="min-w-0 rounded-3xl border border-hairline bg-canvas p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-ink">월별 추세</h2>
      <div role="img" aria-label="월별 지출 추세 막대 차트" className="mt-6 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={trend.months}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--color-hairline-soft)"
              strokeWidth={1}
            />
            <XAxis
              dataKey="month"
              height={48}
              tickFormatter={formatMonthShort}
              tick={({ x, y, payload }) => (
                <text
                  x={x}
                  y={y}
                  dy={16}
                  textAnchor="middle"
                  fill="var(--color-body)"
                  fontSize={12}
                  className="font-mono"
                >
                  <tspan x={x}>{formatMonthShort(payload.value)}</tspan>
                  {trend.months.some(
                    ({ month, inProgress }) => month === payload.value && inProgress,
                  ) && (
                    <tspan x={x} dy={16}>
                      진행 중
                    </tspan>
                  )}
                </text>
              )}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={formatAxisWon}
              tick={axisTick}
              className="font-mono"
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              isAnimationActive={false}
              cursor={{ fill: "var(--color-surface-soft)" }}
              content={({ active, label, payload }) => {
                const total = payload?.[0]?.value;
                if (
                  !active ||
                  typeof label !== "string" ||
                  typeof total !== "number"
                ) return null;

                return (
                  <div className="rounded-lg border border-hairline bg-canvas px-3 py-2 shadow-soft">
                    <p className="text-caption tabular-nums text-body">
                      {formatMonth(label)}
                    </p>
                    <p
                      className={`mt-1 font-mono text-sm ${total < 0 ? "text-body" : "text-ink"}`}
                    >
                      {formatWon(total)}
                    </p>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="total"
              fill="var(--color-primary)"
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            >
              {trend.months.map(({ month, inProgress }) => (
                <Cell
                  key={month}
                  fill={inProgress ? "var(--color-muted-soft)" : "var(--color-primary)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul aria-label="월별 지출 합계" className="sr-only">
        {trend.months.map(({ month, total, inProgress }) => (
          <li key={month}>
            {formatMonth(month)} {formatWon(total)}
            {inProgress ? " 진행 중" : ""}
          </li>
        ))}
      </ul>
      {trend.categoryChanges !== null && trend.categoryChanges.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold text-ink">
            지난달과 달라진 카테고리
          </h3>
          <ul className="mt-4">
            {trend.categoryChanges.map(({ category, diff }) => (
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
        </div>
      )}
    </section>
  );
}
