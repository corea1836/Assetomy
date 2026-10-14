import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { sendMetric } from "@/components/send-metric";
import { MonthlySummary, MonthlySummaryStatus } from "./monthly-summary";

vi.mock("@/components/send-metric", () => ({ sendMetric: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const CARD_CLASSES = [
  "rounded-3xl", "border", "border-primary/25", "bg-primary-soft",
  "bg-linear-to-br", "from-primary/15", "via-primary-soft", "to-canvas", "shadow-glow", "p-6", "sm:p-8",
];

describe("MonthlySummary", () => {
  it("renders one paragraph for each double-newline separated summary paragraph", () => {
    const summary = "이번 달에는 식비 지출이 늘었어요.\n\n확인이 필요한 지출을 살펴보세요.";
    render(<MonthlySummary summary={summary} source="example" />);

    const heading = screen.getByRole("heading", { name: "이번 달 요약", level: 2 });
    expect(heading).toHaveClass("text-lg", "font-semibold", "text-ink");
    expect(heading.closest("section")).toHaveClass(...CARD_CLASSES);
    const paragraphs = screen.getAllByText(/이번 달에는 식비 지출이 늘었어요|확인이 필요한 지출을 살펴보세요/);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toHaveTextContent("이번 달에는 식비 지출이 늘었어요.");
    expect(paragraphs[1]).toHaveTextContent("확인이 필요한 지출을 살펴보세요.");
    paragraphs.forEach((paragraph) => expect(paragraph).toHaveClass("text-lg", "leading-relaxed", "text-ink", "break-keep", "text-pretty"));
    expect(paragraphs[0].parentElement).toHaveClass("space-y-3");
    expect(paragraphs[0].parentElement).not.toHaveClass("whitespace-pre-line");
    expect(paragraphs[0].parentElement?.querySelectorAll("p")).toHaveLength(2);
  });

  it("renders a single paragraph when the summary has no paragraph separator", () => {
    const { container } = render(<MonthlySummary summary="예시 요약 한 문단이에요." source="example" />);
    expect(container.querySelectorAll("p.break-keep")).toHaveLength(1);
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

    const heading = screen.getByRole("heading", { name: "이렇게 절약해 보세요", level: 3 });
    expect(heading).toHaveClass("text-base", "font-semibold", "text-ink");
    const list = screen.getByRole("list");
    expect(list).toHaveClass("mt-2", "list-disc", "space-y-2", "pl-5", "text-base", "leading-relaxed", "text-ink");
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(tips);
    const source = screen.getByText("AI가 가맹점명과 집계로 쓴 요약이에요. 금액은 코드로 계산해요.");
    const summary = screen.getByText("이번 달은 식비 비중이 가장 커요.");
    expect(summary.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("places the summary and tips in two columns from md only when there are tips", () => {
    const { rerender } = render(<MonthlySummary summary="이번 달은 식비 비중이 가장 커요." source="ai" tips={["다음 달 식비 예산을 먼저 정해 보세요."]} />);
    const columns = screen.getByText("이번 달은 식비 비중이 가장 커요.").parentElement!.parentElement!;
    expect(columns).toHaveClass("grid", "gap-6", "md:grid-cols-2", "md:gap-8");
    expect(columns).toContainElement(screen.getByRole("list"));

    rerender(<MonthlySummary summary="이번 달은 식비 비중이 가장 커요." source="example" />);
    expect(screen.getByText("이번 달은 식비 비중이 가장 커요.").parentElement!.parentElement).not.toHaveClass("md:grid-cols-2");
  });

  it("emphasizes filled numbers and replaces arrow markers with colored icons", () => {
    const summary = "9월 1일~9월 30일 동안 78건, 1,820,075원을 썼어요. 지난달보다 ▲12,000원 늘고 8월보다 ▼3,000원 줄었어요. 식비가 24%로 가장 컸어요.";
    const tip = "GS25 역삼점 정기결제가 3개월 이어졌어요. 아직 쓰는지 점검해 보세요.";
    const { container } = render(<MonthlySummary summary={summary} source="ai" tips={[tip]} />);

    const strong = Array.from(container.querySelectorAll("strong"));
    expect(strong.map((element) => element.textContent))
      .toEqual(["9월 1일~9월 30일", "78건", "1,820,075원", "12,000원", "3,000원", "24%", "3개월"]);
    strong.forEach((element) => expect(element).toHaveClass("font-semibold", "tabular-nums", "whitespace-nowrap"));
    const increases = container.querySelectorAll("strong.text-increase");
    const decreases = container.querySelectorAll("strong.text-decrease");
    expect(increases).toHaveLength(1);
    expect(decreases).toHaveLength(1);
    expect(increases[0].querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(increases[0].querySelector("svg")).toHaveClass("inline-block", "align-[-0.125em]");
    expect(decreases[0].querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.textContent).not.toContain("▲");
    expect(container.textContent).not.toContain("▼");
    expect(container.querySelector(".space-y-3 p")?.textContent).toBe(summary.replace(/[▲▼]/gu, ""));
    expect(screen.getByRole("listitem").textContent).toBe(tip);
  });

  it("shows feedback only for enabled real summaries and reuses category feedback", () => {
    const props = {
      summary: "요약 첫 문단이에요.\n\n요약 둘째 문단이에요.",
      source: "ai" as const,
      tips: ["첫 번째 팁이에요.", "같은 카테고리의 다른 팁이에요."],
      tipCategories: ["food", "food"] as ["food", "food"],
      feedback: { food: "평일 점심은 회사에서 먹어요" },
      feedbackEnabled: true,
    };
    const { rerender } = render(<MonthlySummary {...props} />);
    expect(screen.getAllByText("내 피드백: 평일 점심은 회사에서 먹어요")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "수정" })).toHaveLength(2);

    rerender(<MonthlySummary {...props} feedbackEnabled={false} />);
    expect(screen.queryByRole("button", { name: "수정" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "피드백 남기기" })).not.toBeInTheDocument();

    rerender(<MonthlySummary {...props} source="example" />);
    expect(screen.queryByRole("button", { name: "수정" })).not.toBeInTheDocument();
  });

  it("renders no tip heading without tips, as on the demo and landing", () => {
    const { rerender } = render(<MonthlySummary summary="예시 요약 문장이에요." source="example" />);
    expect(screen.queryByRole("heading", { name: "이렇게 절약해 보세요" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    rerender(<MonthlySummary summary="예시 요약 문장이에요." source="ai" tips={[]} />);
    expect(screen.queryByRole("heading", { name: "이렇게 절약해 보세요" })).not.toBeInTheDocument();
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
    expect(pending.closest("section")).toHaveClass(...CARD_CLASSES);
    expect(pending).toHaveClass("text-base", "text-body");
    expect(screen.queryByText("AI가 가맹점명과 집계로 쓴 요약이에요. 금액은 코드로 계산해요.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pro로 보기" })).toBeInTheDocument();

    rerender(<MonthlySummaryStatus state="failed" />);
    expect(screen.getByText("요약을 만들지 못했어요. 새로고침하면 다시 만들어요.")).toBeInTheDocument();
    expect(document.querySelector(".motion-safe\\:animate-spin")).toBeNull();
    expect(document.querySelector(".motion-safe\\:animate-pulse")).toBeNull();
    expect(screen.getByRole("heading", { name: "이번 달 요약" })).toBeInTheDocument();
    expect(screen.queryByText("AI가 가맹점명과 집계로 쓴 요약이에요. 금액은 코드로 계산해요.")).not.toBeInTheDocument();
  });

  it("shows a decorative spinner and a two-column skeleton while pending", () => {
    render(<MonthlySummaryStatus state="pending" />);

    const pending = screen.getByText("이번 달 요약을 만들고 있어요");
    const spinner = pending.parentElement!.querySelector("svg")!;
    expect(pending.parentElement).toHaveClass("mt-4", "flex", "items-center", "gap-2");
    expect(spinner).toHaveAttribute("aria-hidden", "true");
    expect(spinner).toHaveAttribute("width", "20");
    expect(spinner).toHaveClass("shrink-0", "text-primary", "motion-safe:animate-spin");
    const skeleton = pending.closest("section")!.querySelector(".motion-safe\\:animate-pulse")!;
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(skeleton).toHaveClass("mt-6", "grid", "gap-6", "md:grid-cols-2", "md:gap-8");
    expect(skeleton.querySelectorAll(".bg-primary\\/10").length).toBeGreaterThan(0);
    expect(skeleton.textContent).toBe("");
  });

  it("renders markup-looking summary text literally", () => {
    const summary = "<b>태그</b>";
    render(<MonthlySummary summary={summary} source="ai" />);

    expect(screen.getByText(summary)).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });

  it.each([
    ["card-month", "이번 달 요약", "이번 달 요약을 만들고 있어요"],
    ["statement", "이번 명세서 요약", "이번 명세서 요약을 만들고 있어요"],
  ] as const)("supports the %s heading and pending status", (variant, title, pending) => {
    const { rerender } = render(<MonthlySummary summary="요약 문장이에요." source="ai" variant={variant} />);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();

    rerender(<MonthlySummaryStatus state="pending" variant={variant} />);
    expect(screen.getByText(pending)).toBeInTheDocument();
  });

  it.each(["card-month", "statement"] as const)("uses the card upgrade prompt for %s", (variant) => {
    render(<MonthlySummary summary="요약 문장이에요." source="ai" upgrade variant={variant} />);
    expect(screen.getByText("Pro에서는 달라진 카테고리까지 요약해요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pro로 보기" })).toBeInTheDocument();
  });

  it("keeps the monthly upgrade prompt for the default variant", () => {
    render(<MonthlySummary summary="요약 문장이에요." source="ai" upgrade />);
    expect(screen.getByText("Pro에서는 확인할 지출 상세와 여러 달 추세까지 요약해요")).toBeInTheDocument();
  });
});
