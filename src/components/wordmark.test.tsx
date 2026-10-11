import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Wordmark } from "./wordmark";

describe("Wordmark", () => {
  it("renders the lowercase wordmark with the default typography and primary color", () => {
    render(<Wordmark />);

    expect(screen.getByText("assetomy")).toHaveClass(
      "text-[22px]", "font-medium", "leading-none", "tracking-[-0.02em]", "text-primary",
    );
  });

  it("supports an explicit default tone", () => {
    render(<Wordmark tone="default" />);

    expect(screen.getByText("assetomy")).toHaveClass("text-primary");
    expect(screen.getByText("assetomy")).not.toHaveClass("text-white");
  });

  it("uses white text on a dark background", () => {
    render(<Wordmark tone="onDark" />);

    expect(screen.getByText("assetomy")).toHaveClass("text-white");
    expect(screen.getByText("assetomy")).not.toHaveClass("text-primary");
  });
});
