import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyCard } from "./empty-card";

describe("EmptyCard", () => {
  it("shows the empty state and a secondary upload link", () => {
    render(<EmptyCard />);
    expect(screen.getByText("이 카드로 올린 내역이 아직 없어요")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "새 이용내역 추가" });
    expect(link).toHaveAttribute("href", "#upload");
    expect(link).toHaveClass("bg-surface-strong");
  });
});
