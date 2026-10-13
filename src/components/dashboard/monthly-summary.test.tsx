import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { sendMetric } from "@/components/send-metric";
import { MonthlySummary, MonthlySummaryStatus } from "./monthly-summary";

vi.mock("@/components/send-metric", () => ({ sendMetric: vi.fn() }));

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

  it("keeps the example source and has no upgrade prompt by default", () => {
    render(<MonthlySummary summary="예시 요약 문장이에요." source="example" />);

    expect(screen.getByText("예시 요약이에요. 가입하면 AI가 내 가맹점명과 집계로 요약해요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pro로 보기" })).not.toBeInTheDocument();
    expect(screen.queryByText("Pro에서는 확인할 지출 상세와 여러 달 추세까지 요약해요")).not.toBeInTheDocument();
  });

  it("lists tips under their heading between the summary and the source line", () => {
    const tips = ["카드사 앱에서 같은 결제가 두 번 청구됐는지 확인해 보세요.", "다음 달 식비 예산을 먼저 정해 보세요."];
    render(<MonthlySummary summary="이번 달은 식비 비중이 가장 커요." source="ai" tips={tips} />);

    const heading = screen.getByRole("heading", { name: "이렇게 해 보세요", level: 3 });
    expect(heading).toHaveClass("mt-6", "text-base", "font-semibold", "text-ink");
    const list = screen.getByRole("list");
    expect(list).toHaveClass("mt-2", "list-disc", "space-y-2", "pl-5", "text-base", "leading-relaxed", "text-ink");
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(tips);
    const source = screen.getByText("AI가 가맹점명과 집계로 쓴 요약이에요. 금액은 코드로 계산해요.");
    const summary = screen.getByText("이번 달은 식비 비중이 가장 커요.");
    expect(summary.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders no tip heading without tips, as on the demo and landing", () => {
    const { rerender } = render(<MonthlySummary summary="예시 요약 문장이에요." source="example" />);
    expect(screen.queryByRole("heading", { name: "이렇게 해 보세요" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    rerender(<MonthlySummary summary="예시 요약 문장이에요." source="ai" tips={[]} />);
    expect(screen.queryByRole("heading", { name: "이렇게 해 보세요" })).not.toBeInTheDocument();
  });

  it("renders markup-looking tips literally", () => {
    render(<MonthlySummary summary="요약이에요." source="ai" tips={["<i>팁</i>"]} />);
    expect(screen.getByText("<i>팁</i>")).toBeInTheDocument();
    expect(document.querySelector("i")).toBeNull();
  });

  it("shows the Free upgrade prompt and opens the summary upgrade dialog", () => {
    render(<MonthlySummary summary="저장된 요약 문장이에요." source="ai" upgrade />);

    expect(screen.getByText("Pro에서는 확인할 지출 상세와 여러 달 추세까지 요약해요")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pro로 보기" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(sendMetric).toHaveBeenCalledWith({ event: "upgrade_click", source: "summary" });
  });

  it("shows pending and failed status text without an attribution line", () => {
    const { rerender } = render(<MonthlySummaryStatus state="pending" upgrade />);
    const pending = screen.getByText("이번 달 요약을 만들고 있어요");
    expect(pending.closest("section")).toHaveAttribute("aria-busy", "true");
    expect(pending).toHaveClass("mt-4", "text-base", "text-body");
    expect(screen.queryByText("AI가 가맹점명과 집계로 쓴 요약이에요. 금액은 코드로 계산해요.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pro로 보기" })).toBeInTheDocument();

    rerender(<MonthlySummaryStatus state="failed" />);
    expect(screen.getByText("요약을 만들지 못했어요. 새로고침하면 다시 만들어요.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "이번 달 요약" })).toBeInTheDocument();
    expect(screen.queryByText("AI가 가맹점명과 집계로 쓴 요약이에요. 금액은 코드로 계산해요.")).not.toBeInTheDocument();
  });

  it("renders markup-looking summary text literally", () => {
    const summary = "<b>태그</b>";
    render(<MonthlySummary summary={summary} source="ai" />);

    expect(screen.getByText(summary)).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });
});
