import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HyundaiGuide } from "./hyundai-guide";

describe("HyundaiGuide", () => {
  it("provides the same folded PDF guide for onboarding and repeat uploads", () => {
    const { container } = render(<HyundaiGuide />);
    const details = container.querySelector("details");
    expect(details).toHaveAttribute("id", "guide-hyundai");
    expect(details).not.toHaveAttribute("open");
    const summary = screen.getByText("현대카드 이용내역 받는 법");
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary).toHaveClass("focus-visible:outline-primary");
    fireEvent.click(summary);
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("앱이나 웹의 명세서에서 '이용 내역'을 최근순으로 두고 PDF로 저장해 주세요.")).toBeVisible();
    expect(screen.getByText("할부나 취소 표시가 있는 명세서는 아직 읽지 못해요.")).toBeVisible();
  });
});
