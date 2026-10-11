import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardIcon, CheckIcon, SearchIcon, ShieldCheckIcon } from "./icons";

describe("icons", () => {
  it.each([
    ["CardIcon", CardIcon],
    ["CheckIcon", CheckIcon],
    ["SearchIcon", SearchIcon],
    ["ShieldCheckIcon", ShieldCheckIcon],
  ] as const)("%s is a decorative 20px stroke icon in currentColor", (_, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "20");
    expect(svg).toHaveAttribute("height", "20");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("fill", "none");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("stroke-width", "2");
    expect(svg?.children.length).toBeGreaterThan(0);
  });

  it("accepts a size and a class name", () => {
    const { container } = render(<CheckIcon size={18} className="text-primary" />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("width", "18");
    expect(svg).toHaveAttribute("height", "18");
    expect(svg).toHaveClass("text-primary");
  });
});
