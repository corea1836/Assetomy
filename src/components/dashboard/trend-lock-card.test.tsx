import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrendLockCard } from "./trend-lock-card";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockResolvedValue(Response.json({})); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("TrendLockCard", () => {
  it("shows four decorative static bars and clearly labels the example", () => {
    const { container } = render(<TrendLockCard />);
    expect(screen.getByRole("heading", { level: 2, name: "월별 추세" }).closest("section"))
      .toHaveClass("rounded-3xl", "bg-surface-soft", "p-6", "sm:p-8");
    expect(screen.getByText("예시 그림이에요. 실제 내 데이터가 아니에요.")).toHaveClass("text-caption", "text-body");
    expect(screen.getByText("Pro에서는 여러 달 지출 추세와 지난달과 달라진 카테고리를 볼 수 있어요")).toBeInTheDocument();
    const bars = container.querySelectorAll('[aria-hidden="true"] .bg-primary');
    expect(bars).toHaveLength(4);
    for (const bar of bars) expect(bar).toHaveClass("rounded-t-[4px]");
    const forbiddenClass = ["bl", "ur"].join("");
    expect(container.querySelector(`[class*="${forbiddenClass}"]`)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens the common dialog with the trend source", () => {
    render(<TrendLockCard />);
    const opener = screen.getByRole("button", { name: "Pro로 보기" });
    expect(opener).toHaveClass("bg-primary");
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/metrics", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"event":"upgrade_click","source":"trend"}', keepalive: true,
    });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
