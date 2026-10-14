import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MerchantAmount } from "@/types/dashboard";
import { TopMerchants } from "./top-merchants";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const merchants: MerchantAmount[] = [
  {
    merchantKey: "동네식당",
    merchant: "동네 식당",
    category: "food",
    amount: 123_000,
    count: 5,
    cancelCount: 0,
  },
  {
    merchantKey: "동네카페",
    merchant: "동네 카페",
    category: "cafe",
    amount: -12_000,
    count: 2,
    cancelCount: 0,
  },
];

describe("TopMerchants", () => {
  it("shows merchant names, categories, counts and amounts in the DTO order", () => {
    render(<TopMerchants merchants={merchants} otherMerchants={[]} />);

    expect(
      screen.getByRole("heading", { name: "가장 많이 쓴 곳" }),
    ).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("동네 식당")).toHaveClass("truncate");
    expect(within(rows[0]).getByText(/식비/)).toHaveClass("text-body");
    expect(within(rows[0]).getByText(/5건/)).toBeInTheDocument();
    expect(within(rows[0]).getByText("123,000원")).toHaveClass(
      "font-mono",
      "text-right",
    );
    expect(within(rows[1]).getByText("동네 카페")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/카페·간식/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/2건/)).toBeInTheDocument();
    expect(within(rows[1]).getByText("−12,000원")).toHaveClass("font-mono");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("renders HTML-looking merchant names as text without creating an image", () => {
    const merchant = "<img src=x onerror=alert(1)>";
    const { container } = render(
      <TopMerchants merchants={[{ ...merchants[0], merchant }]} otherMerchants={[]} />,
    );

    expect(screen.getByText(merchant)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows five merchants and folds the rest in a closed disclosure", () => {
    const five = Array.from({ length: 5 }, (_, index) => ({ ...merchants[0], merchantKey: `key-${index}`, merchant: `가맹점 ${index}` }));
    const { container } = render(<TopMerchants merchants={five} otherMerchants={[merchants[1]]} />);
    expect(container.querySelectorAll("section > ul > li")).toHaveLength(5);
    const details = container.querySelector("details");
    expect(details).not.toHaveAttribute("open");
    expect(details?.querySelector("summary")).toHaveTextContent("나머지 1곳 보기");
    expect(details?.querySelector("summary")).toHaveClass("text-primary", "font-semibold", "focus-visible:outline-primary");
    expect(details?.querySelectorAll("li")).toHaveLength(1);
    expect(within(details as HTMLElement).getByText("−12,000원")).toHaveClass("text-body");
    expect(container.querySelector("select")).toBeNull();
  });

  it("omits the disclosure when there are no other merchants", () => {
    const { container } = render(<TopMerchants merchants={merchants} otherMerchants={[]} />);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.queryByText("카테고리를 바꾸면 같은 가맹점의 모든 거래에 적용돼요")).not.toBeInTheDocument();
  });

  it("offers a category select for every merchant, including the folded rows", () => {
    const { container } = render(<TopMerchants merchants={[merchants[0]]} otherMerchants={[merchants[1]]} editable />);
    for (const row of merchants) {
      const select = screen.getByLabelText(`${row.merchant} 카테고리`);
      expect(select).toHaveValue(row.category);
      expect(select).toHaveClass("h-9", "rounded-lg", "px-3", "text-sm");
      expect(screen.getByText(`${row.count}건`)).toBeInTheDocument();
    }
    expect(container.querySelectorAll("select")).toHaveLength(2);
    expect(screen.getByText("카테고리를 바꾸면 같은 가맹점의 모든 거래에 적용돼요")).toHaveClass("text-caption", "text-body");
  });

  it("shows kept and cancelled transaction counts for editable and read-only rows", () => {
    const rows: MerchantAmount[] = [
      { ...merchants[0], count: 1, cancelCount: 1 },
      { ...merchants[1], count: 0, cancelCount: 1 },
      { ...merchants[0], merchantKey: "three", merchant: "세 건 가맹점", count: 3, cancelCount: 0 },
    ];
    const { rerender } = render(<TopMerchants merchants={rows} otherMerchants={[]} />);
    const readOnlyRows = screen.getAllByRole("listitem");
    expect(readOnlyRows[0]).toHaveTextContent("1건 · 취소 1건");
    expect(readOnlyRows[1]).toHaveTextContent("취소 1건");
    expect(readOnlyRows[2]).toHaveTextContent("3건");

    rerender(<TopMerchants merchants={rows} otherMerchants={[]} editable />);
    expect(screen.getByText("1건 · 취소 1건")).toBeInTheDocument();
    expect(screen.getByText("취소 1건")).toBeInTheDocument();
    expect(screen.getByText("3건")).toBeInTheDocument();
  });
});
