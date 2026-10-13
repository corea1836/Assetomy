import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CategoryAmount } from "@/types/dashboard";
import { CategoryList } from "./category-list";

const categories: CategoryAmount[] = [
  { category: "food", amount: 60_000, ratio: 0.5 },
  { category: "cafe", amount: 15_000, ratio: 0.125 },
  { category: "etc", amount: 0, ratio: 0 },
  { category: "shopping", amount: -12_000, ratio: -0.1 },
];

const many: CategoryAmount[] = [
  { category: "shopping", amount: 500_000, ratio: 0.5 },
  { category: "food", amount: 200_000, ratio: 0.2 },
  { category: "cafe", amount: 100_000, ratio: 0.1 },
  { category: "transport", amount: 80_000, ratio: 0.08 },
  { category: "delivery", amount: 60_000, ratio: 0.06 },
  { category: "health", amount: 40_000, ratio: 0.04 },
  { category: "etc", amount: 20_000, ratio: 0.02 },
];

function arcs(container: HTMLElement): SVGCircleElement[] {
  return [...container.querySelectorAll<SVGCircleElement>("svg circle")];
}

function arcLength(arc: SVGCircleElement): number {
  return Number(arc.getAttribute("stroke-dasharray")?.split(" ")[0]);
}

function dot(row: HTMLElement): Element | null {
  return row.querySelector("[data-slice-dot]");
}

describe("CategoryList", () => {
  it("keeps the DTO order and shows labels, full amounts and ratios", () => {
    render(<CategoryList categories={categories} total={63_000} />);

    expect(screen.getByRole("heading", { name: "카테고리" })).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    const labels = ["식비", "카페·간식", "기타", "쇼핑"];
    const amounts = ["60,000원", "15,000원", "0원", "−12,000원"];
    const ratios = ["50%", "13%", "0%", "−10%"];

    expect(rows).toHaveLength(4);
    rows.forEach((row, index) => {
      expect(within(row).getByText(labels[index])).toBeInTheDocument();
      expect(within(row).getByText(amounts[index])).toHaveClass("font-mono");
      expect(within(row).getByText(ratios[index])).toBeInTheDocument();
    });
  });

  it("omits the ratio when it is missing", () => {
    render(<CategoryList categories={[{ category: "etc", amount: -1_000, ratio: null }]} total={-1_000} />);

    expect(screen.getByRole("listitem")).not.toHaveTextContent("%");
  });

  it("draws a donut of the positive categories in rank colors, starting at twelve o'clock", () => {
    const { container } = render(<CategoryList categories={categories} total={63_000} />);

    const chart = screen.getByRole("img", { name: "카테고리 비중 도넛 차트" });
    const slices = arcs(container);
    expect(slices).toHaveLength(2);
    expect(slices[0]).toHaveClass("stroke-category-1");
    expect(slices[1]).toHaveClass("stroke-category-2");
    expect(chart.querySelector("svg g")).toHaveAttribute("transform", "rotate(-90 100 100)");

    // 양수 합계(75,000원) 기준 비중대로 나누고, 조각 사이에 2만큼 틈을 둔다.
    const circumference = 2 * Math.PI * 84;
    expect(arcLength(slices[0])).toBeCloseTo(circumference * 0.8 - 2, 2);
    expect(arcLength(slices[1])).toBeCloseTo(circumference * 0.2 - 2, 2);
    expect(Number(slices[0].getAttribute("stroke-dashoffset"))).toBeCloseTo(0, 2);
    expect(Number(slices[1].getAttribute("stroke-dashoffset"))).toBeCloseTo(-circumference * 0.8, 2);
    expect(slices[0].querySelector("title")).toHaveTextContent("식비 60,000원 50%");
  });

  it("shows the total in the middle of the donut", () => {
    render(<CategoryList categories={categories} total={63_000} />);

    const chart = screen.getByRole("img", { name: "카테고리 비중 도넛 차트" });
    expect(chart).toHaveTextContent("총지출");
    expect(within(chart).getByText("63,000원")).toHaveClass("font-mono");
  });

  it("draws a single category as a full ring without a gap", () => {
    const { container } = render(
      <CategoryList categories={[{ category: "food", amount: 10_000, ratio: 1 }]} total={10_000} />,
    );

    expect(arcLength(arcs(container)[0])).toBeCloseTo(2 * Math.PI * 84, 2);
  });

  it("marks positive rows with their slice color and leaves nonpositive rows without a dot", () => {
    render(<CategoryList categories={categories} total={63_000} />);

    const rows = screen.getAllByRole("listitem");
    expect(dot(rows[0])).toHaveClass("bg-category-1");
    expect(dot(rows[1])).toHaveClass("bg-category-2");
    expect(dot(rows[0])).toHaveAttribute("aria-hidden", "true");
    expect(dot(rows[2])).toBeNull();
    expect(dot(rows[3])).toBeNull();
  });

  it("draws no donut when the month total is not positive", () => {
    const { container } = render(<CategoryList categories={categories.slice(2)} total={-12_000} />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(arcs(container)).toHaveLength(0);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows up to five categories without an other row or a disclosure", () => {
    const { container } = render(<CategoryList categories={many.slice(0, 5)} total={940_000} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByText("그 밖")).not.toBeInTheDocument();
    expect(container.querySelector("details")).toBeNull();
    expect(arcs(container).map((arc) => arc.getAttribute("class"))).toEqual(
      [1, 2, 3, 4, 5].map((slot) => `stroke-category-${slot}`),
    );
  });

  it("groups everything after the top five into a gray other slice and row", () => {
    const { container } = render(<CategoryList categories={many} total={1_000_000} />);

    const visible = [...container.querySelectorAll<HTMLElement>("section > ul > li")];
    expect(visible.map((row) => row.querySelector("span")?.textContent)).toEqual(
      ["쇼핑", "식비", "카페·간식", "교통", "배달", "그 밖"],
    );
    const other = visible[5];
    expect(within(other).getByText("60,000원")).toHaveClass("font-mono");
    expect(within(other).getByText("6%")).toBeInTheDocument();
    expect(dot(other)).toHaveClass("bg-category-other");

    const slices = arcs(container);
    expect(slices).toHaveLength(6);
    expect(slices[5]).toHaveClass("stroke-category-other");
    expect(arcLength(slices[5])).toBeCloseTo(2 * Math.PI * 84 * 0.06 - 2, 2);
    expect(slices[5].querySelector("title")).toHaveTextContent("그 밖 60,000원 6%");
  });

  it("folds the other categories into a closed disclosure with gray dots", () => {
    const { container } = render(<CategoryList categories={many} total={1_000_000} />);

    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(details?.querySelector("summary")).toHaveTextContent("나머지 2개 카테고리 보기");
    const folded = [...(details?.querySelectorAll<HTMLElement>("li") ?? [])];
    expect(folded.map((row) => row.querySelector("span")?.textContent)).toEqual(["의료·건강", "기타"]);
    folded.forEach((row) => expect(dot(row)).toHaveClass("bg-category-other"));
  });

  it("leaves the other slice out when the folded categories net to zero or less", () => {
    const { container } = render(
      <CategoryList
        categories={[...many.slice(0, 5), { category: "etc", amount: -5_000, ratio: -0.005 }]}
        total={935_000}
      />,
    );

    const other = screen.getByText("그 밖").closest("li") as HTMLElement;
    expect(within(other).getByText("−5,000원")).toBeInTheDocument();
    expect(dot(other)).toBeNull();
    expect(arcs(container)).toHaveLength(5);
  });
});
