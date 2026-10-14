import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardTabs } from "./card-tabs";

describe("CardTabs", () => {
  const cards = [{ id: "card-1", label: "생활비 카드" }, { id: "card/2?", label: "온라인 쇼핑 카드" }];

  it("links to the overall dashboard and each encoded card view", () => {
    render(<CardTabs cards={cards} activeCardId="card-1" />);

    expect(screen.getByRole("navigation", { name: "카드 보기" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "전체" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "생활비 카드" })).toHaveAttribute("href", "/dashboard?card=card-1");
    expect(screen.getByRole("link", { name: "온라인 쇼핑 카드" })).toHaveAttribute("href", "/dashboard?card=card%2F2%3F");
    expect(screen.getByRole("link", { name: "생활비 카드" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "전체" })).not.toHaveAttribute("aria-current");
  });

  it("marks the overall tab current when no card is active", () => {
    render(<CardTabs cards={cards} activeCardId={null} />);

    expect(screen.getByRole("link", { name: "전체" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "생활비 카드" })).not.toHaveAttribute("aria-current");
  });
});
