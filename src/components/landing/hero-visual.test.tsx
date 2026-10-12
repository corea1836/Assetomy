import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroVisual } from "@/components/landing/hero-visual";
import type { Findings, Snapshot } from "@/types/dashboard";

const snapshot: Snapshot = {
  month: "2026-08",
  period: { from: "2026-08-01", to: "2026-08-31" },
  total: 123_456,
  transactionCount: 12,
  inProgress: false,
  categories: [
    { category: "education", amount: 80_000, ratio: 0.65 },
    { category: "travel", amount: 20_000, ratio: 0.16 },
    { category: "etc", amount: 23_456, ratio: 0.19 },
    { category: "food", amount: 0, ratio: 0 },
  ],
  topMerchants: [],
  daily: [
    { date: "2026-08-01", amount: 12_000 },
    { date: "2026-08-02", amount: 32_000 },
    { date: "2026-08-03", amount: -4_500 },
    { date: "2026-08-04", amount: 0 },
  ],
};

const findings: Findings = {
  candidateTotal: 67_890,
  byKind: {
    recurring: { count: 1, amount: 10_000 },
    duplicate: { count: 2, amount: 45_000 },
    large: { count: 3, amount: 20_000 },
  },
  items: [
    {
      kind: "recurring",
      merchantKey: "music",
      merchant: "예시 음악",
      category: "subscription",
      amount: 10_000,
      seriesMonths: ["2026-07", "2026-08"],
      transactions: [{ id: "r1", date: "2026-08-01", amount: 10_000, cardLabel: "카드 A" }],
    },
    {
      kind: "duplicate",
      merchantKey: "shop",
      merchant: "예시 상점",
      category: "shopping",
      amount: 45_000,
      transactions: [
        { id: "d1", date: "2026-08-12", amount: 15_000, cardLabel: "카드 A" },
        { id: "d2", date: "2026-08-12", amount: 15_000, cardLabel: "카드 A" },
        { id: "d3", date: "2026-08-12", amount: 15_000, cardLabel: "카드 A" },
      ],
    },
    {
      kind: "duplicate",
      merchantKey: "other-shop",
      merchant: "예시 다른 상점",
      category: "shopping",
      amount: 24_000,
      transactions: [
        { id: "d4", date: "2026-08-18", amount: 12_000, cardLabel: "카드 B" },
        { id: "d5", date: "2026-08-18", amount: 12_000, cardLabel: "카드 B" },
      ],
    },
  ],
};

const props = {
  month: "2026-08",
  cardLabels: ["카드 A", "카드 B", "카드 C"],
  snapshot,
  findings,
};

describe("HeroVisual", () => {
  it("shows the supplied total, top three categories, and candidate summary", () => {
    render(<HeroVisual {...props} />);

    const title = screen.getByText("2026년 8월 총지출");
    expect(title.parentElement).toHaveClass("bg-surface-dark-raised", "shadow-float");
    expect(screen.getByText("123,456원")).toHaveClass("font-mono", "text-3xl");
    const rows = within(screen.getByRole("list", { name: "예시 상위 카테고리" }))
      .getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    [
      ["교육", "80,000원"],
      ["여행·숙박", "20,000원"],
      ["기타", "23,456원"],
    ].forEach(([label, amount], index) => {
      expect(rows[index]).toHaveTextContent(label);
      expect(rows[index]).toHaveTextContent(amount);
      expect(rows[index].querySelector("div.bg-primary-on-dark")).not.toBeNull();
    });
    expect(screen.getByText("확인이 필요한 지출 6건 · 후보 합계 67,890원"))
      .toHaveClass("text-amber-200");
    expect(screen.getByText("예시 데이터")).toBeInTheDocument();
  });

  it("shows the first two card labels with the ordered file extensions", () => {
    render(<HeroVisual {...props} />);

    for (const name of ["카드 A.xlsx", "카드 B.csv"]) {
      expect(screen.getByText(name)).toHaveClass("bg-surface-dark-elevated", "border-hairline-dark");
    }
    expect(screen.queryByText(/카드 C/)).not.toBeInTheDocument();
  });

  it("uses the first duplicate's first transaction and count in one rendered sentence", () => {
    render(<HeroVisual {...props} />);

    const sentence = "중복 결제 의심 · 8월 12일 15,000원 × 3";
    const chip = screen.getByText(sentence);
    expect(chip).toHaveClass("text-amber-200", "bg-surface-dark-raised", "shadow-float");
    expect(screen.queryByText("중복 결제 의심 · 8월 18일 12,000원 × 2"))
      .not.toBeInTheDocument();
    const html = renderToStaticMarkup(<HeroVisual {...props} />);
    for (const text of [
      sentence, "카드 A.xlsx", "카드 B.csv", "확인이 필요한 지출 6건 · 후보 합계 67,890원",
    ]) expect(html).toContain(text);
  });

  it("omits the floating chip when there is no duplicate finding", () => {
    render(<HeroVisual {...props} findings={{
      ...findings,
      items: findings.items.filter(({ kind }) => kind !== "duplicate"),
    }} />);

    expect(screen.queryByText(/중복 결제 의심/)).not.toBeInTheDocument();
    expect(screen.getByText("123,456원")).toBeInTheDocument();
  });

  it("names the daily bars for the supplied month and highlights only the largest day", () => {
    render(<HeroVisual {...props} />);

    const chart = screen.getByRole("img", { name: "2026년 8월 일별 지출 막대(예시)" });
    const bars = chart.querySelectorAll('div[aria-hidden="true"]');
    expect(bars).toHaveLength(snapshot.daily.length);
    expect(bars[1]).toHaveClass("bg-primary-on-dark");
    expect(chart.querySelectorAll(".bg-primary-on-dark")).toHaveLength(1);
    for (const index of [0, 2, 3]) expect(bars[index]).toHaveClass("bg-primary-on-dark/40");
    expect(bars[1]).toHaveStyle({ height: "100%" });
    expect(bars[0]).toHaveStyle({ height: "37.5%" });
  });

  it("has no links, buttons, keyboard stops, or entrance motion", () => {
    const { container } = render(<HeroVisual {...props} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("[tabindex], .reveal")).toBeNull();
  });
});
