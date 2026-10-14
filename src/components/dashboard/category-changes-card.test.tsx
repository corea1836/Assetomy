import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CategoryChangesCard } from "./category-changes-card";

describe("CategoryChangesCard", () => {
  it.each([
    ["month", "지난달과 달라진 카테고리"],
    ["cycle", "지난 명세서와 달라진 카테고리"],
  ] as const)("shows the %s heading and category change", (basis, title) => {
    const { container } = render(<CategoryChangesCard basis={basis} changes={[
      { category: "food", current: 50_000, previous: 20_000, diff: 30_000 },
      { category: "cafe", current: 10_000, previous: 15_000, diff: -5_000 },
    ]} />);

    expect(screen.getByRole("heading", { name: title })).toHaveClass("text-lg", "font-semibold", "text-ink");
    expect(screen.getByText("식비")).toBeInTheDocument();
    expect(container.querySelector(".text-increase")).toHaveTextContent("+30,000원 늘었어요");
    expect(container.querySelector(".text-decrease")).toHaveTextContent("−5,000원 줄었어요");
    const increase = container.querySelector(".text-increase")!;
    const decrease = container.querySelector(".text-decrease")!;
    expect(increase).toHaveClass("whitespace-nowrap");
    expect(decrease).toHaveClass("whitespace-nowrap");
    expect(increase.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(increase.querySelector("svg path")).toHaveAttribute("d", "m5 12 7-7 7 7");
    expect(decrease.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(decrease.querySelector("svg path")).toHaveAttribute("d", "M12 5v14");
    expect(container.querySelector("section")).toHaveClass("rounded-3xl", "border", "border-hairline", "bg-canvas");
  });

  it("does not render a card when there are no changes", () => {
    const { container } = render(<CategoryChangesCard basis="month" changes={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
