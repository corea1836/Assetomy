import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CategoryAmount } from "@/types/dashboard";
import { CategoryList } from "./category-list";

const categories: CategoryAmount[] = [
  { category: "cafe", amount: 15_000, ratio: 0.125 },
  { category: "food", amount: 60_000, ratio: 0.5 },
  { category: "shopping", amount: -12_000, ratio: -0.1 },
  { category: "etc", amount: 0, ratio: null },
];

describe("CategoryList", () => {
  it("keeps the DTO order and shows labels, full amounts and ratios", () => {
    render(<CategoryList categories={categories} />);

    expect(screen.getByRole("heading", { name: "카테고리" })).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    const labels = ["카페·간식", "식비", "쇼핑", "기타"];
    const amounts = ["15,000원", "60,000원", "−12,000원", "0원"];
    const ratios = ["13%", "50%", "−10%"];

    rows.forEach((row, index) => {
      expect(within(row).getByText(labels[index])).toBeInTheDocument();
      expect(within(row).getByText(amounts[index])).toHaveClass("font-mono");
      if (index < ratios.length) {
        expect(within(row).getByText(ratios[index])).toBeInTheDocument();
      } else {
        expect(within(row).queryByText(/%/)).not.toBeInTheDocument();
      }
    });
    expect(rows).toHaveLength(4);
  });

  it("sizes positive bars against the maximum and omits nonpositive bars", () => {
    render(<CategoryList categories={categories} />);

    const rows = screen.getAllByRole("listitem");
    const firstBar = rows[0].querySelector("div.bg-primary");
    expect(firstBar).toHaveStyle({ width: "25%" });
    expect(firstBar).toHaveClass("h-2", "rounded-r-[4px]");
    expect(rows[1].querySelector("div.bg-primary")).toHaveStyle({
      width: "100%",
    });
    expect(rows[2].querySelector("div.bg-primary")).toBeNull();
    expect(rows[3].querySelector("div.bg-primary")).toBeNull();
  });

  it("shows a zero ratio when supplied instead of treating it as missing", () => {
    render(
      <CategoryList categories={[{ category: "etc", amount: 0, ratio: 0 }]} />,
    );

    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("renders an all-nonpositive list without bars", () => {
    const { container } = render(<CategoryList categories={categories.slice(2)} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelector("div.bg-primary")).toBeNull();
  });
});
