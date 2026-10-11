import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Findings } from "@/types/dashboard";
import { FindingsList } from "./findings-list";

const recurringTransaction = {
  id: "recurring-august",
  date: "2026-08-15",
  amount: 10_000,
  cardLabel: "신한 생활비",
};

const findings: Findings = {
  byKind: {
    recurring: { count: 1, amount: 10_000 },
    duplicate: { count: 1, amount: 20_000 },
    large: { count: 1, amount: 220_000 },
  },
  // The recurring transaction also appears in a duplicate finding.
  candidateTotal: 240_000,
  items: [
    {
      kind: "recurring",
      merchantKey: "월간음악",
      merchant: "월간 음악",
      category: "subscription",
      amount: 10_000,
      seriesMonths: ["2026-06", "2026-07", "2026-08"],
      transactions: [recurringTransaction],
    },
    {
      kind: "duplicate",
      merchantKey: "월간음악",
      merchant: "월간 음악",
      category: "subscription",
      amount: 20_000,
      transactions: [
        recurringTransaction,
        { ...recurringTransaction, id: "duplicate-august", cardLabel: "현대 개인" },
      ],
    },
    {
      kind: "large",
      merchantKey: "생활상점",
      merchant: "생활 상점",
      category: "shopping",
      amount: 220_000,
      transactions: [
        { id: "large-august", date: "2026-08-22", amount: 220_000, cardLabel: "현대 개인" },
      ],
    },
  ],
};

const emptyFindings: Findings = {
  byKind: {
    recurring: { count: 0, amount: 0 },
    duplicate: { count: 0, amount: 0 },
    large: { count: 0, amount: 0 },
  },
  candidateTotal: 0,
  items: [],
};

describe("FindingsList", () => {
  it("shows each kind's count and amount and the supplied candidate total", () => {
    render(<FindingsList findings={findings} dataMonthCount={3} />);

    expect(screen.getByRole("heading", { name: "확인이 필요한 지출" })).toBeInTheDocument();
    const summary = screen.getByRole("list", { name: "탐지 종류별 요약" });
    const rows = within(summary).getAllByRole("listitem");
    const labels = ["정기결제로 보여요", "중복 결제 의심", "고액 결제"];
    const amounts = ["1건 · 10,000원", "1건 · 20,000원", "1건 · 220,000원"];
    expect(rows).toHaveLength(3);
    rows.forEach((row, index) => {
      expect(row).toHaveTextContent(labels[index]);
      expect(row).toHaveTextContent(amounts[index]);
    });
    expect(screen.getByText(/후보 합계/)).toHaveTextContent("후보 합계 240,000원");
    expect(screen.queryByText(/후보 합계 250,000원/)).not.toBeInTheDocument();
    expect(screen.getByText("같은 거래는 한 번만 셌어요. 정상 지출일 수 있어요.")).toBeInTheDocument();
  });

  it("shows finding details and the recurring series months", () => {
    render(<FindingsList findings={findings} dataMonthCount={3} />);

    const details = screen.getByRole("list", { name: "확인할 지출 상세" });
    expect(within(details).getAllByText("월간 음악")).toHaveLength(2);
    expect(within(details).getByText("생활 상점")).toBeInTheDocument();
    expect(within(details).getAllByText("구독·정기결제")).toHaveLength(2);
    expect(within(details).getByText("쇼핑")).toBeInTheDocument();
    expect(within(details).getByText("6월 · 7월 · 8월 결제")).toBeInTheDocument();
    expect(within(details).getByText("20,000원")).toHaveClass("font-mono", "text-right");
  });

  it("shows transaction dates, card labels and full amounts", () => {
    render(<FindingsList findings={findings} dataMonthCount={3} />);

    const details = screen.getByRole("list", { name: "확인할 지출 상세" });
    expect(within(details).getAllByText(/8월 15일/)).toHaveLength(3);
    expect(within(details).getAllByText(/신한 생활비/)).toHaveLength(2);
    expect(within(details).getAllByText(/현대 개인/)).toHaveLength(2);
    expect(within(details).getByText(/8월 22일/)).toBeInTheDocument();
    expect(within(details).getAllByText("10,000원")).toHaveLength(4);
    expect(within(details).getAllByText("220,000원")).toHaveLength(2);
  });

  it("shows the empty notice instead of the summary and details when items are empty", () => {
    render(<FindingsList findings={emptyFindings} dataMonthCount={3} />);

    expect(screen.getByText("이번 규칙으로 확인할 지출 후보가 발견되지 않았어요")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText(/후보 합계/)).not.toBeInTheDocument();
  });

  it.each([findings, emptyFindings])("adds the one-month guidance with or without findings", (dto) => {
    render(<FindingsList findings={dto} dataMonthCount={1} />);

    expect(screen.getByText("한 달치만 더 올리면 정기결제를 찾아드려요")).toBeInTheDocument();
  });

  it("omits the one-month guidance when two months are available", () => {
    render(<FindingsList findings={findings} dataMonthCount={2} />);

    expect(screen.queryByText("한 달치만 더 올리면 정기결제를 찾아드려요")).not.toBeInTheDocument();
  });

  it("renders HTML-looking merchant names and card labels as text", () => {
    const merchant = "<script>alert(1)</script>";
    const cardLabel = "<img src=x onerror=alert(1)>";
    const { container } = render(
      <FindingsList
        findings={{
          ...findings,
          items: [{
            ...findings.items[0],
            merchant,
            transactions: [{ ...recurringTransaction, cardLabel }],
          }],
        }}
        dataMonthCount={3}
      />,
    );

    expect(screen.getByText(merchant)).toBeInTheDocument();
    expect(screen.getByText(new RegExp("<img src=x onerror=alert\\(1\\)>"))).toBeInTheDocument();
    expect(container.querySelector("script, img")).toBeNull();
  });

  it("uses calm candidate wording without prohibited claims", () => {
    const { container } = render(<FindingsList findings={findings} dataMonthCount={3} />);

    expect(container.textContent).not.toMatch(/절약|낭비|부정 결제|AI가 분석/);
  });
});
