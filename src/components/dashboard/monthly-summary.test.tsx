import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MonthlySummary } from "./monthly-summary";

describe("MonthlySummary", () => {
  it("shows the supplied summary with the title and preserves line breaks", () => {
    const summary = "이번 달에는 식비 지출이 늘었어요.\n확인이 필요한 지출을 살펴보세요.";
    render(<MonthlySummary summary={summary} source="example" />);

    const heading = screen.getByRole("heading", { name: "이번 달 요약", level: 2 });
    expect(heading).toHaveClass("text-lg", "font-semibold", "text-ink");
    expect(heading.closest("section")).toHaveClass("rounded-3xl", "bg-primary-soft", "p-6", "sm:p-8");
    const body = screen.getByText(/이번 달에는 식비 지출이 늘었어요/);
    expect(body.textContent).toBe(summary);
    expect(body).toHaveClass("text-lg", "text-ink", "leading-relaxed", "whitespace-pre-line");
  });

  it.each([
    ["ai", "AI가 가맹점명과 집계로 쓴 요약이에요. 금액은 코드로 계산해요."],
    ["example", "예시 요약이에요. 가입하면 AI가 내 가맹점명과 집계로 요약해요."],
  ] as const)("shows the %s source below the summary", (source, message) => {
    const summary = "확인이 필요한 지출을 살펴보세요.";
    render(<MonthlySummary summary={summary} source={source} />);

    const attribution = screen.getByText(message);
    expect(attribution).toHaveClass("text-caption", "text-body");
    expect(screen.getByText(summary).compareDocumentPosition(attribution))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("keeps the 20px sparkle decorative beside the unchanged heading name", () => {
    render(<MonthlySummary summary="이번 달 요약 문장이에요." source="example" />);

    const heading = screen.getByRole("heading", { name: "이번 달 요약", level: 2 });
    const icon = heading.parentElement?.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("width", "20");
    expect(icon).toHaveAttribute("height", "20");
    expect(icon).toHaveClass("text-primary");
  });

  it("renders a script-looking summary as text without creating a script element", () => {
    const summary = "<script>alert(1)</script>";
    const { container } = render(<MonthlySummary summary={summary} source="example" />);

    expect(screen.getByText(summary)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });

  it("does not add prohibited claims to the supplied text", () => {
    const { container } = render(<MonthlySummary summary="정기결제로 보이는 지출은 정상 지출일 수 있어요." source="example" />);

    expect(container.textContent).not.toMatch(/절약|낭비|부정 결제|AI가 분석|Powered by AI/);
  });
});
