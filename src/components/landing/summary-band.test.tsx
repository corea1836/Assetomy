import { render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FINDING_KIND_LABELS } from "@/components/dashboard/finding-labels";
import { SummaryBand } from "@/components/landing/summary-band";
import { buildDashboard } from "@/lib/analytics/dashboard";
import { DEMO_SUMMARY, DEMO_TODAY, DEMO_TRANSACTIONS } from "@/lib/demo/fixture";
import { formatDate, formatMonth, formatMonthShort, formatWon } from "@/lib/format";

const dashboard = buildDashboard({
  transactions: DEMO_TRANSACTIONS, plan: "pro", today: DEMO_TODAY,
});
if (dashboard?.plan !== "pro") throw new Error("Expected a Pro demo dashboard");

const props = {
  month: dashboard.month,
  summary: DEMO_SUMMARY,
  findings: dashboard.findings,
  trend: dashboard.trend,
  mom: dashboard.mom,
};
const title = "숫자는 코드가 계산하고, 요약은 문장으로 정리해요";
const numbers = ["①", "②", "③"];

describe("SummaryBand", () => {
  it("shows the title and subtitle above the example monthly summary in an isolated dark band", () => {
    render(<SummaryBand {...props} />);

    const heading = screen.getByRole("heading", { name: title, level: 2 });
    expect(heading).toHaveClass("text-display-sm");
    expect(heading.closest(".reveal")).not.toBeNull();
    expect(screen.getByText("매달 집계를 읽고 달라진 점과 확인할 지출을 한 문단으로 정리해요."))
      .toHaveClass("text-lg", "text-muted-soft");
    const band = heading.closest("section")!;
    expect(band).toHaveClass("relative", "isolate", "overflow-hidden", "bg-surface-dark", "text-white");
    expect(band.querySelectorAll(".landing-dots")).toHaveLength(1);
    expect(band.querySelectorAll(".landing-light")).toHaveLength(1);
    expect(band.querySelector(".landing-light")).toHaveClass("left-1/2");
    expect(band.querySelector(".landing-light")?.parentElement)
      .toHaveAttribute("aria-hidden", "true");
    const summaryCard = screen.getByRole("heading", { name: "이번 달 요약" }).closest("section")!;
    expect(summaryCard).toHaveClass("bg-primary-soft");
    expect(within(summaryCard).getByText(DEMO_SUMMARY)).toHaveClass("whitespace-pre-line", "text-ink");
    expect(within(summaryCard).getByText("예시 요약이에요. 가입하면 AI가 내 가맹점명과 집계로 요약해요."))
      .toBeInTheDocument();
  });

  it("orders evidence as large, recurring, and duplicate with the supplied descriptions and amounts", () => {
    render(<SummaryBand {...props} />);

    const evidence = screen.getByRole("list", { name: "요약의 근거" });
    expect(evidence.closest(".reveal")).not.toBeNull();
    const rows = within(evidence).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    const large = props.findings.items.find(({ kind }) => kind === "large")!;
    const recurring = props.findings.items.filter(({ kind }) => kind === "recurring");
    const duplicate = props.findings.items.find(({ kind }) => kind === "duplicate")!;
    const descriptions = [
      `${formatDate(large.transactions[0].date)} ${large.merchant}`,
      recurring.map(({ merchant }) => merchant).join(" · "),
      `${formatDate(duplicate.transactions[0].date)} ${duplicate.merchant}`,
    ];
    const amounts = [formatWon(large.amount), "2건 · 69,900원", "32,000원 × 2"];
    (["large", "recurring", "duplicate"] as const).forEach((kind, index) => {
      expect(rows[index]).toHaveClass("rounded-3xl", "border-hairline-dark", "bg-surface-dark-elevated", "p-6");
      expect(within(rows[index]).getByText(numbers[index]))
        .toHaveClass("text-primary-on-dark");
      expect(within(rows[index]).getByText(numbers[index])).toHaveAttribute("aria-hidden", "true");
      expect(within(rows[index]).getByText(FINDING_KIND_LABELS[kind]))
        .toHaveClass("text-amber-200", "text-sm");
      expect(within(rows[index]).getByText(descriptions[index])).toHaveClass("text-muted-soft");
      expect(within(rows[index]).getByText(amounts[index])).toHaveClass("font-mono", "text-white");
    });
  });

  it("selects the largest large finding and only the first duplicate without changing the input order", () => {
    const large = props.findings.items.find(({ kind }) => kind === "large")!;
    const duplicate = props.findings.items.find(({ kind }) => kind === "duplicate")!;
    const biggest = {
      ...large, merchantKey: "biggest", merchant: "가장 큰 예시 결제", amount: 1_200_000,
      transactions: [{ ...large.transactions[0], date: "2026-09-25", amount: 1_200_000 }],
    };
    const items = [...props.findings.items, biggest, { ...duplicate, merchantKey: "later", merchant: "나중 예시 결제" }];
    const originalItems = [...items];
    render(<SummaryBand {...props} findings={{ ...props.findings, items }} />);

    const rows = within(screen.getByRole("list", { name: "요약의 근거" })).getAllByRole("listitem");
    expect(within(rows[0]).getByText("9월 25일 가장 큰 예시 결제")).toBeInTheDocument();
    expect(within(rows[0]).getByText("1,200,000원")).toBeInTheDocument();
    expect(within(rows[0]).queryByText(new RegExp(large.merchant))).not.toBeInTheDocument();
    expect(within(rows[2]).getByText(`${formatDate(duplicate.transactions[0].date)} ${duplicate.merchant}`))
      .toBeInTheDocument();
    expect(within(rows[2]).queryByText(/나중 예시 결제/)).not.toBeInTheDocument();
    expect(items).toEqual(originalItems);
  });

  it("uses byKind for recurring counts and amounts", () => {
    render(<SummaryBand {...props} findings={{
      ...props.findings,
      byKind: { ...props.findings.byKind, recurring: { count: 3, amount: 123_456 } },
    }} />);

    expect(within(screen.getByRole("list", { name: "요약의 근거" })).getByText("3건 · 123,456원"))
      .toBeInTheDocument();
  });

  it.each(["large", "recurring", "duplicate"] as const)(
    "omits absent %s evidence and renumbers the remaining rows",
    (absentKind) => {
      render(<SummaryBand {...props} findings={{
        ...props.findings, items: props.findings.items.filter(({ kind }) => kind !== absentKind),
      }} />);

      const evidence = screen.getByRole("list", { name: "요약의 근거" });
      const rows = within(evidence).getAllByRole("listitem");
      const kinds = (["large", "recurring", "duplicate"] as const).filter((kind) => kind !== absentKind);
      expect(rows).toHaveLength(2);
      expect(within(evidence).queryByText(FINDING_KIND_LABELS[absentKind])).not.toBeInTheDocument();
      kinds.forEach((kind, index) => {
        expect(within(rows[index]).getByText(FINDING_KIND_LABELS[kind])).toBeInTheDocument();
        expect(within(rows[index]).getByText(numbers[index])).toHaveAttribute("aria-hidden", "true");
      });
      expect(within(evidence).queryByText("③")).not.toBeInTheDocument();
      const chart = screen.getByRole("img", { name: "월별 지출 추세 막대(예시)" });
      expect(within(chart).queryByText("①") !== null).toBe(absentKind !== "large");
    },
  );

  it("shows one proportional bar per trend month and highlights only the selected month with the large marker", () => {
    const trend = props.trend!;
    render(<SummaryBand {...props} month={trend.months[1].month} />);

    const chart = screen.getByRole("img", { name: "월별 지출 추세 막대(예시)" });
    const bars = chart.querySelectorAll(".bg-primary-on-dark, .bg-primary-on-dark\\/40");
    expect(bars).toHaveLength(trend.months.length);
    const maxAmount = Math.max(...trend.months.map(({ total }) => total));
    trend.months.forEach(({ month, total }, index) => {
      expect(bars[index]).toHaveClass("max-w-6", "rounded-t-[4px]",
        index === 1 ? "bg-primary-on-dark" : "bg-primary-on-dark/40");
      expect(bars[index]).toHaveStyle({ height: `${(total / maxAmount) * 100}%` });
      expect(within(chart).getByText(formatMonthShort(month))).toBeInTheDocument();
    });
    expect(within(chart).getByText("①")).toHaveAttribute("aria-hidden", "true");
    expect(bars[1]).toContainElement(within(chart).getByText("①"));
    const amounts = screen.getByRole("list", { name: "예시 월별 지출 금액" });
    trend.months.forEach(({ month, total }) => {
      expect(within(amounts).getByText(`${formatMonth(month)} · ${formatWon(total)}`)).toBeInTheDocument();
    });
  });

  it("keeps zero and negative trend totals finite without drawing negative heights", () => {
    render(<SummaryBand {...props} trend={{
      months: [
        { month: "2026-08", total: -100, inProgress: false },
        { month: "2026-09", total: 0, inProgress: false },
      ],
      categoryChanges: null,
    }} />);

    const chart = screen.getByRole("img", { name: "월별 지출 추세 막대(예시)" });
    for (const bar of chart.querySelectorAll(".bg-primary-on-dark, .bg-primary-on-dark\\/40")) {
      expect(bar).toHaveStyle({ height: "0%" });
    }
  });

  it.each([
    [909_200, "8월보다 +909,200원 늘었어요"],
    [-45_000, "8월보다 −45,000원 줄었어요"],
    [0, "8월과 같아요"],
  ])("shows the %s month-over-month change as a white sentence", (diff, sentence) => {
    render(<SummaryBand {...props} mom={{ previousMonth: "2026-08", previousTotal: 608_000, diff }} />);

    expect(screen.getByText(sentence)).toHaveClass("text-white", "tabular-nums");
    expect(screen.getByText(sentence)).not.toHaveClass("text-increase", "text-decrease");
    expect(renderToString(<SummaryBand {...props} mom={{ previousMonth: "2026-08", previousTotal: 608_000, diff }} />))
      .toContain(sentence);
  });

  it("omits the chart and comparison when their inputs are null", () => {
    render(<SummaryBand {...props} trend={null} mom={null} />);

    expect(screen.queryByRole("img", { name: "월별 지출 추세 막대(예시)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "예시 월별 지출 금액" })).not.toBeInTheDocument();
    expect(screen.queryByText(/8월보다/)).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "요약의 근거" })).toBeInTheDocument();
  });

  it("has no links, buttons, or keyboard stops and server-renders intact evidence sentences", () => {
    const { container } = render(<SummaryBand {...props} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("[tabindex]")).toBeNull();
    const html = renderToString(<SummaryBand {...props} />);
    for (const sentence of [DEMO_SUMMARY, "2건 · 69,900원", "32,000원 × 2"]) {
      expect(html).toContain(sentence);
    }
  });
});
