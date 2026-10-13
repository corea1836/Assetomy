import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UpgradeButton } from "./upgrade-button";

describe("UpgradeButton", () => {
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
