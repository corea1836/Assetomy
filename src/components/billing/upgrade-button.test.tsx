import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Teaser } from "@/types/dashboard";
import { UpgradeButton } from "./upgrade-button";

vi.mock("@/components/send-metric", () => ({ sendMetric: vi.fn() }));

describe("UpgradeButton", () => {
  it("passes optional current candidates to the dialog", () => {
    const teaser: Teaser = {
      byKind: { recurring: { count: 1, amount: 10_000 }, duplicate: { count: 0, amount: 0 }, large: { count: 0, amount: 0 } }, candidateTotal: 10_000,
    };
    render(<UpgradeButton source="summary" label="Pro로 보기" teaser={teaser} />);
    fireEvent.click(screen.getByRole("button", { name: "Pro로 보기" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("내 이용내역에서 확인이 필요한 지출 1건 · 후보 합계 10,000원");
  });

  it("opens only on click and restores focus after closing", () => {
    render(<UpgradeButton source="settings" label="업그레이드" />);
    const opener = screen.getByRole("button", { name: "업그레이드" });
    expect(opener).toHaveClass("bg-primary");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("supports a secondary trigger", () => {
    render(<UpgradeButton source="settings" label="업그레이드" variant="secondary" />);
    expect(screen.getByRole("button", { name: "업그레이드" })).toHaveClass("bg-surface-strong");
  });
});
