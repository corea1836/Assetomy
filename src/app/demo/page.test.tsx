import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoPage from "./page";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/demo",
}));

async function renderDemo() {
  render(await DemoPage({ searchParams: Promise.resolve({}) }));
}

const follows = (first: Element, second: Element) =>
  first.compareDocumentPosition(second) === Node.DOCUMENT_POSITION_FOLLOWING;

describe("demo page", () => {
  beforeEach(() => {
    // jsdom has no layout; give the responsive charts measurable bounds.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 640, 256),
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("offers the sign-up CTA in the header and again after the summary", async () => {
    await renderDemo();

    const links = screen.getAllByRole("link", { name: "내 이용내역으로 해보기" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "/login");
    expect(links[0]).toHaveClass("bg-primary", "h-9");
    expect(links[1]).toHaveClass("bg-primary", "h-11");

    const heading = screen.getByRole("heading", { name: "내 카드로 확인해 보세요", level: 2 });
    const cta = heading.closest("section");
    expect(cta).not.toBeNull();
    expect(within(cta as HTMLElement).getByRole("link")).toBe(links[1]);
    expect(within(cta as HTMLElement).getByText(
      "카드사에서 받은 이용내역 파일을 올리면 이 화면이 내 숫자로 바뀌어요. 최근 3개월치를 올리면 정기결제까지 찾아드려요.",
    )).toBeInTheDocument();
    expect(follows(screen.getByRole("heading", { name: "이번 달 요약" }), heading)).toBe(true);
  });

  it("marks where the Pro-only part starts, between the daily chart and the findings", async () => {
    await renderDemo();

    const note = screen.getByText(
      "여기부터 Pro 화면이에요. Free에서는 확인할 지출의 건수와 합계만 보여요.",
    );
    expect(within(note.parentElement as HTMLElement).getByText("Pro"))
      .toHaveClass("bg-primary-soft", "text-primary-active");
    expect(follows(screen.getByRole("heading", { name: "일별 지출" }), note)).toBe(true);
    expect(follows(note, screen.getByRole("heading", { name: "확인이 필요한 지출" }))).toBe(true);
  });

  it("keeps the sample-data notice before the dashboard", async () => {
    await renderDemo();

    const notice = screen.getByText("예시 데이터로 만든 화면이에요. 실제 카드 내역이 아니에요.");
    expect(follows(notice, screen.getByRole("heading", { level: 1 }))).toBe(true);
  });
});
