import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MonthlySummary } from "./monthly-summary";

describe("MonthlySummary", () => {
  it("shows the supplied summary with the title and preserves line breaks", () => {
    const summary = "이번 달에는 식비 지출이 늘었어요.\n확인이 필요한 지출을 살펴보세요.";
    render(<MonthlySummary summary={summary} />);

    expect(screen.getByRole("heading", { name: "이번 달 요약" })).toBeInTheDocument();
    const body = screen.getByText(/이번 달에는 식비 지출이 늘었어요/);
    expect(body.textContent).toBe(summary);
    expect(body).toHaveClass("text-base", "text-body", "leading-relaxed", "whitespace-pre-line");
  });

  it("renders a script-looking summary as text without creating a script element", () => {
    const summary = "<script>alert(1)</script>";
    const { container } = render(<MonthlySummary summary={summary} />);

    expect(screen.getByText(summary)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });

  it("does not add prohibited claims to the supplied text", () => {
    const { container } = render(<MonthlySummary summary="정기결제로 보이는 지출은 정상 지출일 수 있어요." />);

    expect(container.textContent).not.toMatch(/절약|낭비|부정 결제|AI가 분석/);
  });
});
