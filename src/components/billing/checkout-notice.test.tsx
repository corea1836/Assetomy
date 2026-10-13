import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CheckoutNotice } from "./checkout-notice";

describe("CheckoutNotice", () => {
  it("announces Pro activation", () => {
    render(<CheckoutNotice plan="pro" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Pro가 활성화됐어요");
    expect(status).toHaveClass("bg-primary-soft", "text-primary-active");
    expect(screen.queryByRole("link", { name: "새로고침" })).not.toBeInTheDocument();
  });

  it("announces a pending payment and links to the same success address", () => {
    const { container } = render(<CheckoutNotice plan="free" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("status")).toHaveTextContent("결제 반영 중…");
    expect(screen.getByText("잠시 후 새로고침해 주세요")).toBeInTheDocument();
    const reload = screen.getByRole("link", { name: "새로고침" });
    expect(reload).toHaveAttribute("href", "/dashboard?checkout=success");
    expect(reload).toHaveClass("text-primary", "focus-visible:outline-primary");
    expect(container.innerHTML).not.toMatch(/amber|danger/);
  });
});
