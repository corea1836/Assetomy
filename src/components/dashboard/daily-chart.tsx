"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatAxisWon, formatDate, formatWon } from "@/lib/format";
import type { DailyAmount } from "@/types/dashboard";

const axisTick = {
  fill: "var(--color-body)",
  fontSize: 12,
  className: "font-mono",
};

export function DailyChart({ daily }: { daily: DailyAmount[] }): React.JSX.Element {
  return (
    <section className="min-w-0 rounded-3xl border border-hairline bg-canvas p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-ink">일별 지출</h2>
      <div role="img" aria-label="일별 지출 막대 차트" className="mt-6 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={daily}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--color-hairline-soft)"
              strokeWidth={1}
            />
            <XAxis
              dataKey="date"
              tickFormatter={(date: string) =>
                formatDate(date).split(" ")[1].replace("일", "")
              }
              tick={axisTick}
              className="font-mono"
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
                const amount = payload?.[0]?.value;
                if (
                  !active ||
                  typeof label !== "string" ||
                  typeof amount !== "number"
                ) return null;

                return (
                  <div className="rounded-lg border border-hairline bg-canvas px-3 py-2 shadow-soft">
                    <p className="text-caption tabular-nums text-body">
                      {formatDate(label)}
                    </p>
                    <p
                      className={`mt-1 font-mono text-sm ${amount < 0 ? "text-body" : "text-ink"}`}
                    >
                      {formatWon(amount)}
                    </p>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="amount"
              fill="var(--color-primary)"
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
