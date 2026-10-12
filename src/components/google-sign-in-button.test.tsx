import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GoogleSignInButton } from "./google-sign-in-button";

describe("GoogleSignInButton", () => {
  it("provides the named submit button with the light theme and visible focus", () => {
    render(<GoogleSignInButton />);

    const button = screen.getByRole("button", { name: "Google로 계속하기" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveClass(
      "border-[#747775]", "bg-white", "h-11", "w-full", "rounded-full",
      "text-[#1F1F1F]", "font-medium", "hover:bg-surface-soft",
      "active:scale-[.98]", "focus-visible:outline-2",
      "focus-visible:outline-offset-2", "focus-visible:outline-primary",
    );
  });

  it("keeps the decorative Google G at 18px in its original aspect ratio and four colors", () => {
    render(<GoogleSignInButton />);

    const button = screen.getByRole("button", { name: "Google로 계속하기" });
    const svg = button.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "18");
    expect(svg).toHaveAttribute("height", "18");
    expect(svg).toHaveAttribute("viewBox", "0 0 48 48");
    for (const fill of ["#EA4335", "#4285F4", "#FBBC05", "#34A853"]) {
      expect(svg?.querySelector(`path[fill="${fill}"]`)).toBeInTheDocument();
    }
    expect(button.firstElementChild).toBe(svg);
  });
});
