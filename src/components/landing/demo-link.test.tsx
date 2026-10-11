import { fireEvent, render, screen } from "@testing-library/react";
import { track } from "@vercel/analytics";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DemoLink } from "./demo-link";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("DemoLink", () => {
  it("links to the demo and preserves the supplied content and class", () => {
    render(<DemoLink className="rounded-full">데모 보기</DemoLink>);

    const link = screen.getByRole("link", { name: "데모 보기" });
    expect(link).toHaveAttribute("href", "/demo");
    expect(link).toHaveClass("rounded-full");
    expect(track).not.toHaveBeenCalled();
  });

  it("tracks exactly one demo_click event without properties on click", () => {
    render(<DemoLink>데모 보기</DemoLink>);
    const link = screen.getByRole("link", { name: "데모 보기" });
    link.addEventListener("click", (event) => event.preventDefault());

    fireEvent.click(link);

    expect(track).toHaveBeenCalledExactlyOnceWith("demo_click");
    expect(link).toHaveAttribute("href", "/demo");
  });
});
