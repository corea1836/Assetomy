import { render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FINDING_KIND_LABELS } from "@/components/dashboard/finding-labels";
import { FeatureShowcase } from "@/components/landing/feature-showcase";
import { buildDashboard } from "@/lib/analytics/dashboard";
import { DEMO_TODAY, DEMO_TRANSACTIONS } from "@/lib/demo/fixture";
import { formatDate, formatMonthShort, formatWon } from "@/lib/format";

const dashboard = buildDashboard({
  transactions: DEMO_TRANSACTIONS, plan: "pro", today: DEMO_TODAY,
});
if (dashboard?.plan !== "pro") throw new Error("Expected a Pro demo dashboard");

const props = {
  month: dashboard.month,
  dataMonths: dashboard.months.map(({ month }) => month),
  cardLabels: [...new Set(DEMO_TRANSACTIONS.map(({ cardLabel }) => cardLabel))],
  snapshot: dashboard.snapshot,
  findings: dashboard.findings,
};

const features = [
  ["한 화면에 모든 카드", "카드사마다 받은 이용내역 파일을 올리면 카드별로 나눠 합산해요."],
  ["확인이 필요한 지출", "정기결제로 보이는 결제, 중복 결제 의심, 평소보다 큰 결제를 찾아드려요. 정상 지출일 수도 있어요."],
  ["연동 없이, 언제든 삭제", "계좌나 카드사에 연동하지 않아요. 원본 파일은 암호화해 보관하고, 원할 때 바로 지울 수 있어요."],
];

describe("FeatureShowcase", () => {
  it("keeps all three feature titles, descriptions, and 24px icons in revealed article rows", () => {
    render(<FeatureShowcase {...props} />);

    const rows = screen.getAllByRole("article");
    expect(rows).toHaveLength(3);
    features.forEach(([title, description], index) => {
      const row = rows[index];
      expect(row).toHaveClass("reveal", "lg:grid-cols-2");
      const heading = within(row).getByRole("heading", { name: title, level: 3 });
      expect(heading).toHaveClass("text-title-lg", "text-ink");
      expect(within(row).getByText(description))
        .toHaveClass("text-lg", "leading-relaxed", "text-body");
      const icon = heading.parentElement?.querySelector('svg[aria-hidden="true"]');
      expect(icon).toHaveAttribute("width", "24");
      expect(icon).toHaveAttribute("height", "24");
      expect(icon).toHaveClass("text-primary");
      const picture = row.querySelector(".bg-surface-soft");
      expect(picture).toHaveClass("rounded-3xl", "p-6", "sm:p-8");
      expect(heading.compareDocumentPosition(picture!))
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      if (index === 1) {
        expect(heading.parentElement).toHaveClass("lg:order-2");
        expect(picture).toHaveClass("lg:order-1");
      }
    });
  });

  it("merges every supplied card label into the supplied month, total, and transaction count", () => {
    const snapshot = { ...props.snapshot, total: 123_456, transactionCount: 7 };
    render(<FeatureShowcase {...props} month="2026-08" snapshot={snapshot}
      cardLabels={[...props.cardLabels, "추가 카드"]} />);

    const row = screen.getAllByRole("article")[0];
    for (const label of [...props.cardLabels, "추가 카드"]) {
      expect(within(row).getByText(label)).toBeInTheDocument();
    }
    expect(within(row).getByText("8월 총지출 123,456원 · 거래 7건"))
      .toBeInTheDocument();
    expect(row.querySelector('svg[aria-hidden="true"][stroke-width="1"]'))
      .not.toBeNull();
  });

  it("centers each card chip in an equal column so its connector drops from the chip", () => {
    render(<FeatureShowcase {...props} />);

    const row = screen.getAllByRole("article")[0];
    const chips = within(row).getByRole("list", { name: "예시 카드" });
    expect(chips).toHaveClass("grid", "justify-items-center");
    expect(chips).toHaveStyle({ gridTemplateColumns: `repeat(${props.cardLabels.length}, minmax(0, 1fr))` });
    const paths = Array.from(row.querySelectorAll('svg[stroke-width="1"] path'))
      .map((path) => path.getAttribute("d"));
    expect(paths).toEqual(["M60 0V16H120V32", "M180 0V16H120V32"]);
  });

  it("aligns each feature's text with the top of its illustration", () => {
    render(<FeatureShowcase {...props} />);

    for (const row of screen.getAllByRole("article")) {
      expect(row).toHaveClass("items-start");
      expect(row).not.toHaveClass("items-center");
    }
  });

  it("shows every recurring merchant with sorted month ticks, matching dots, and a text period", () => {
    const originalMonths = [...props.dataMonths];
    render(<FeatureShowcase {...props} />);

    const recurring = props.findings.items.filter((item) => item.kind === "recurring");
    const region = screen.getByRole("region", { name: FINDING_KIND_LABELS.recurring });
    const rows = within(region).getAllByRole("listitem");
    expect(rows).toHaveLength(recurring.length);
    recurring.forEach((item, index) => {
      expect(within(rows[index]).getByText(`${item.merchant} · ${formatWon(item.amount)}`))
        .toBeInTheDocument();
      const months = [...item.seriesMonths].sort();
      expect(within(rows[index]).getByText(
        `${formatMonthShort(months[0])}~${formatMonthShort(months[months.length - 1])} 매달 결제`,
      )).toBeInTheDocument();
      const timeline = rows[index].querySelector('div[aria-hidden="true"]')!;
      expect([...timeline.children].map((tick) => tick.textContent)).toEqual(
        [...props.dataMonths].sort().map(formatMonthShort),
      );
      expect(timeline.querySelectorAll(".rounded-full.bg-primary"))
        .toHaveLength(item.seriesMonths.length);
    });
    expect(props.dataMonths).toEqual(originalMonths);
  });

  it("places recurring dots only in the months belonging to that series", () => {
    const recurring = props.findings.items.find((item) => item.kind === "recurring")!;
    const months = [...props.dataMonths].sort();
    render(<FeatureShowcase {...props} findings={{
      ...props.findings,
      items: [{ ...recurring, seriesMonths: [months[3], months[1]] }],
    }} />);

    const region = screen.getByRole("region", { name: FINDING_KIND_LABELS.recurring });
    const timeline = region.querySelector('div[aria-hidden="true"]')!;
    expect([...timeline.children].map((tick) => Boolean(tick.querySelector(".rounded-full"))))
      .toEqual([false, true, false, true]);
    expect(within(region).getByText(
      `${formatMonthShort(months[1])}~${formatMonthShort(months[3])} 매달 결제`,
    )).toBeInTheDocument();
  });

  it("shows one small cell per transaction for only the first duplicate finding", () => {
    const duplicate = props.findings.items.find(({ kind }) => kind === "duplicate")!;
    render(<FeatureShowcase {...props} findings={{
      ...props.findings,
      items: [...props.findings.items, { ...duplicate, merchantKey: "other", merchant: "다른 예시" }],
    }} />);

    const region = screen.getByRole("region", { name: FINDING_KIND_LABELS.duplicate });
    expect(within(region).getByText(duplicate.merchant)).toBeInTheDocument();
    const cells = within(region).getAllByRole("listitem");
    expect(cells).toHaveLength(duplicate.transactions.length);
    duplicate.transactions.forEach(({ date, amount }, index) => {
      expect(within(cells[index]).getByText(`${formatDate(date)} · ${formatWon(amount)}`))
        .toBeInTheDocument();
    });
    expect(within(region).queryByText("다른 예시")).not.toBeInTheDocument();
  });

  it("shows only the first large finding and highlights its day in the supplied daily bars", () => {
    const large = props.findings.items.find(({ kind }) => kind === "large")!;
    const transaction = large.transactions[0];
    render(<FeatureShowcase {...props} findings={{
      ...props.findings,
      items: [...props.findings.items, { ...large, merchantKey: "other", merchant: "다른 예시" }],
    }} />);

    const region = screen.getByRole("region", { name: FINDING_KIND_LABELS.large });
    expect(within(region).getByText(
      `${formatDate(transaction.date)} ${large.merchant} ${formatWon(large.amount)}`,
    )).toBeInTheDocument();
    const bars = region.querySelector('div[aria-hidden="true"]')!.children;
    expect(bars).toHaveLength(props.snapshot.daily.length);
    const maxAmount = Math.max(...props.snapshot.daily.map(({ amount }) => amount));
    props.snapshot.daily.forEach(({ date, amount }, index) => {
      expect(bars[index]).toHaveClass("max-w-6", "rounded-t-[4px]",
        date === transaction.date ? "bg-primary" : "bg-primary/40");
      expect(bars[index]).toHaveStyle({ height: `${(Math.max(0, amount) / maxAmount) * 100}%` });
    });
    expect(within(region).queryByText(/다른 예시/)).not.toBeInTheDocument();
    expect(screen.getByText("정상 지출일 수 있어요")).toHaveClass("text-caption", "text-body");
  });

  it.each(["recurring", "duplicate", "large"] as const)(
    "omits the %s panel when it has no items",
    (absentKind) => {
      render(<FeatureShowcase {...props} findings={{
        ...props.findings,
        items: props.findings.items.filter(({ kind }) => kind !== absentKind),
      }} />);

      expect(screen.queryByRole("region", { name: FINDING_KIND_LABELS[absentKind] }))
        .not.toBeInTheDocument();
      for (const kind of ["recurring", "duplicate", "large"] as const) {
        if (kind !== absentKind) {
          expect(screen.getByRole("region", { name: FINDING_KIND_LABELS[kind] }))
            .toHaveClass("rounded-2xl", "border-amber-200", "bg-amber-50", "text-amber-900");
        }
      }
    },
  );

  it("lists the file it receives and all three pieces of information it does not receive", () => {
    render(<FeatureShowcase {...props} />);

    const row = screen.getAllByRole("article")[2];
    expect(within(row).getByText("받는 것")).toBeInTheDocument();
    const file = within(row).getByText("카드사에서 받은 이용내역 파일");
    expect(file.parentElement?.querySelector("svg")).toHaveClass("text-primary");
    expect(within(row).getByText("받지 않는 것")).toBeInTheDocument();
    for (const label of ["카드번호", "계좌", "카드사 비밀번호"]) {
      const item = within(row).getByText(label).closest("li")!;
      expect(item.querySelector('svg[aria-hidden="true"]')).toHaveClass("text-body");
    }
  });

  it("has no links, buttons, or keyboard stops and keeps server-rendered sentences intact", () => {
    const { container } = render(<FeatureShowcase {...props} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("[tabindex]")).toBeNull();
    const html = renderToString(<FeatureShowcase {...props} />);
    for (const sentence of [
      `${formatMonthShort(props.month)} 총지출 ${formatWon(props.snapshot.total)} · 거래 ${props.snapshot.transactionCount}건`,
      ...props.findings.items.filter((item) => item.kind === "recurring")
        .map((item) => `${item.merchant} · ${formatWon(item.amount)}`),
    ]) expect(html).toContain(sentence);
  });
});
