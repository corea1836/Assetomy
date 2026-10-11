import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MerchantAmount } from "@/types/dashboard";
import { TopMerchants } from "./top-merchants";

const merchants: MerchantAmount[] = [
  {
    merchantKey: "동네식당",
    merchant: "동네 식당",
    category: "food",
    amount: 123_000,
    count: 5,
  },
  {
    merchantKey: "동네카페",
    merchant: "동네 카페",
    category: "cafe",
    amount: -12_000,
    count: 2,
  },
];

describe("TopMerchants", () => {
  it("shows merchant names, categories, counts and amounts in the DTO order", () => {
    render(<TopMerchants merchants={merchants} />);

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
  });

  it("renders HTML-looking merchant names as text without creating an image", () => {
    const merchant = "<img src=x onerror=alert(1)>";
    const { container } = render(
      <TopMerchants merchants={[{ ...merchants[0], merchant }]} />,
    );

    expect(screen.getByText(merchant)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
