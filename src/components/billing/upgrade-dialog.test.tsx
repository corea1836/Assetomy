import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FINDING_KIND_LABELS } from "@/components/dashboard/finding-labels";
import { billingErrorMessage } from "@/lib/errors/messages";
import { UpgradeDialog } from "./upgrade-dialog";

const fetchMock = vi.fn<typeof fetch>();
const assign = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  assign.mockReset();
  onClose.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  const testWindow = Object.create(window);
  Object.defineProperty(testWindow, "location", { value: { assign } });
  vi.stubGlobal("window", testWindow);
});
afterEach(() => vi.unstubAllGlobals());

function open(opener: HTMLElement | null = null) {
  return render(<UpgradeDialog source="settings" opener={opener} onClose={onClose} />);
}

describe("UpgradeDialog", () => {
  it("orders static examples, price, cancellation notice, and buttons with honest copy", () => {
    const { container } = open();
    const dialog = screen.getByRole("dialog", { name: "Pro에서 확인할 지출 상세를 볼 수 있어요" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveClass("rounded-3xl", "bg-canvas", "p-6", "sm:p-8", "max-w-md", "w-full");
    expect(dialog.parentElement).toHaveClass("fixed", "inset-0", "bg-surface-dark/40");
    const examples = within(dialog).getByRole("list");
    expect(within(examples).getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
    expect(examples).toHaveClass("bg-amber-50", "border-amber-200", "text-amber-900");
    expect(examples).toHaveTextContent(FINDING_KIND_LABELS.recurring);
    expect(examples).toHaveTextContent(FINDING_KIND_LABELS.duplicate);
    expect(examples).toHaveTextContent("예시 OTT");
    const caption = within(dialog).getByText("예시 화면이에요. 실제 내 데이터가 아니에요.");
    const price = within(dialog).getByText("월 6,900원");
    expect(within(dialog).getByText("해외에서는 $4.99/월로 결제돼요")).toBeInTheDocument();
    const cancellation = within(dialog).getByText("설정에서 언제든 해지할 수 있어요. 남은 기간까지 Pro로 써요");
    const pay = within(dialog).getByRole("button", { name: "결제하기" });
    const close = within(dialog).getByRole("button", { name: "닫기" });
    for (const [first, second] of [[examples, caption], [caption, price], [price, cancellation], [cancellation, pay]]) {
      expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(pay).toHaveClass("bg-primary", "w-full", "sm:w-auto", "sm:order-2");
    expect(close).toHaveClass("bg-surface-strong", "w-full", "sm:w-auto");
    expect(pay.parentElement).toHaveClass("flex-col", "sm:flex-row", "sm:justify-end");
    expect(container).not.toHaveTextContent(/절약|할인|지금|남은 시간/);
  });

  it("focuses the panel, locks scrolling, closes on Escape and restores the opener on unmount", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    document.body.style.overflow = "auto";
    const view = open(opener);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
    opener.remove();
  });

  it("cycles Tab and Shift+Tab within the dialog including the initial panel focus", () => {
    open();
    const dialog = screen.getByRole("dialog");
    const pay = screen.getByRole("button", { name: "결제하기" });
    const close = screen.getByRole("button", { name: "닫기" });
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(pay).toHaveFocus();
    fireEvent.keyDown(pay, { key: "Tab", shiftKey: true });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(pay).toHaveFocus();
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(close).toHaveFocus();
  });

  it("closes from the secondary button and supports no opener", () => {
    const view = open();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(() => view.unmount()).not.toThrow();
  });

  it("sends one checkout request, blocks closing while pending and stays disabled after navigation", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise((res) => { resolve = res; }));
    open();
    const pay = screen.getByRole("button", { name: "결제하기" });
    fireEvent.click(pay);
    fireEvent.click(pay);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"source":"settings"}',
    });
    expect(screen.getByRole("button", { name: "결제 화면 여는 중…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "닫기" })).toBeDisabled();
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(false);
    await act(async () => resolve(Response.json({ url: "https://polar.test/checkout" })));
    await waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith("https://polar.test/checkout"));
    expect(screen.getByRole("button", { name: "결제 화면 여는 중…" })).toBeDisabled();
  });

  it.each([
    { status: 503, body: { error: { code: "TEMPORARY_FAILURE" } }, code: "TEMPORARY_FAILURE" as const },
    { status: 401, body: { error: { code: "UNAUTHORIZED" } }, code: "UNAUTHORIZED" as const },
    { status: 200, body: { url: 123 }, code: "TEMPORARY_FAILURE" as const },
    { status: 200, body: {}, code: "TEMPORARY_FAILURE" as const },
  ])("shows the mapped error and allows retry for $status/$code", async ({ status, body, code }) => {
    fetchMock.mockResolvedValueOnce(Response.json(body, { status }));
    open();
    fireEvent.click(screen.getByRole("button", { name: "결제하기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(billingErrorMessage(code));
    expect(screen.getByRole("button", { name: "결제하기" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "닫기" })).toBeEnabled();
    expect(assign).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(Response.json({ url: "https://polar.test/retry" }));
    fireEvent.click(screen.getByRole("button", { name: "결제하기" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://polar.test/retry"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("maps a network failure without exposing its message", async () => {
    fetchMock.mockRejectedValue(new Error("private gateway response"));
    open();
    fireEvent.click(screen.getByRole("button", { name: "결제하기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(billingErrorMessage("TEMPORARY_FAILURE"));
    expect(screen.getByRole("dialog")).not.toHaveTextContent("private gateway response");
    expect(screen.getByRole("button", { name: "결제하기" })).toBeEnabled();
  });
});
