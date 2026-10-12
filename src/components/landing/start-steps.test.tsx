import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StartSteps } from "@/components/landing/start-steps";

const steps = [
  ["01", "카드사에서 이용내역 받기",
    "카드사 홈페이지에서 신용카드 이용내역(승인내역)을 엑셀이나 CSV 파일로 받아요. 청구서가 아니라 이용내역이에요."],
  ["02", "파일마다 카드 고르기",
    "‘생활비 카드’처럼 이름을 붙여 카드별로 나눠 봐요. 카드번호는 받지 않아요."],
  ["03", "올리고 확인하기",
    "최근 3개월치를 올리면 총지출·카테고리와 함께 정기결제까지 찾아드려요."],
];

describe("StartSteps", () => {
  it("preserves the three numbered titles and descriptions in the revealed starting list", () => {
    render(<StartSteps cardLabel="생활비 카드" />);

    const list = screen.getByRole("list", { name: "시작하는 순서" });
    expect(list).toHaveClass("reveal", "sm:grid-cols-3");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    steps.forEach(([number, title, description], index) => {
      expect(within(items[index]).getByText(number))
        .toHaveClass("font-mono", "text-sm", "text-primary");
      expect(within(items[index]).getByRole("heading", { name: title, level: 3 }))
        .toHaveClass("text-lg", "font-semibold");
      expect(within(items[index]).getByText(description))
        .toHaveClass("text-base", "leading-relaxed", "text-body");
    });
  });

  it("places hidden format badges, the supplied card label, and three unnumbered bars above the titles", () => {
    const { container } = render(<StartSteps cardLabel="내 생활비 카드" />);

    const pictures = container.querySelectorAll('.rounded-2xl[aria-hidden="true"]');
    expect(pictures).toHaveLength(3);
    const headings = screen.getAllByRole("heading", { level: 3 });
    pictures.forEach((picture, index) => {
      expect(picture).toHaveClass("border", "border-hairline", "bg-canvas");
      expect(picture.textContent).not.toMatch(/[0-9]|원/);
      expect(picture.compareDocumentPosition(headings[index]))
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(within(pictures[0] as HTMLElement).getByText("XLSX")).toBeInTheDocument();
    expect(within(pictures[0] as HTMLElement).getByText("CSV")).toBeInTheDocument();
    expect(within(pictures[1] as HTMLElement).getByText("내 생활비 카드")).toBeInTheDocument();
    const bars = pictures[2].querySelectorAll(".bg-primary");
    expect(bars).toHaveLength(3);
    for (const bar of bars) expect(bar).toBeEmptyDOMElement();
  });

  it("connects the numbers with hidden responsive hairlines without adding focus targets", () => {
    const { container } = render(<StartSteps cardLabel="생활비 카드" />);

    const lines = container.querySelectorAll('.bg-hairline[aria-hidden="true"]');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toHaveClass("w-px", "sm:h-px");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("[tabindex]")).toBeNull();
  });
});
