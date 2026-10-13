import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billingErrorMessage } from "@/lib/errors/messages";
import { ManageSubscriptionButton } from "./manage-subscription-button";

const fetchMock = vi.fn<typeof fetch>();
const assign = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  assign.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  const testWindow = Object.create(window);
  Object.defineProperty(testWindow, "location", { value: { assign } });
  vi.stubGlobal("window", testWindow);
});
afterEach(() => vi.unstubAllGlobals());

describe("ManageSubscriptionButton", () => {
  it("opens the portal with a JSON POST and prevents duplicate requests", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise((res) => { resolve = res; }));
    render(<ManageSubscriptionButton />);
    const button = screen.getByRole("button", { name: "구독 관리" });
    expect(button).toHaveClass("bg-surface-strong");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/portal", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    expect(button).toBeDisabled();
    await act(async () => resolve(Response.json({ url: "https://polar.test/portal" })));
    await waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith("https://polar.test/portal"));
    expect(button).toBeDisabled();
  });

  it.each([
    { status: 404, body: { error: { code: "NOT_FOUND" } }, code: "NOT_FOUND" as const },
    { status: 503, body: { error: { code: "TEMPORARY_FAILURE" } }, code: "TEMPORARY_FAILURE" as const },
    { status: 200, body: { url: null }, code: "TEMPORARY_FAILURE" as const },
  ])("shows the mapped $code error and enables retry", async ({ status, body, code }) => {
    fetchMock.mockResolvedValueOnce(Response.json(body, { status }));
    render(<ManageSubscriptionButton />);
    fireEvent.click(screen.getByRole("button", { name: "구독 관리" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(billingErrorMessage(code));
    expect(screen.getByRole("button", { name: "구독 관리" })).toBeEnabled();
    expect(assign).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(Response.json({ url: "https://polar.test/portal/retry" }));
    fireEvent.click(screen.getByRole("button", { name: "구독 관리" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://polar.test/portal/retry"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("handles network failure with the shared error message", async () => {
    fetchMock.mockRejectedValue(new Error("private response"));
    render(<ManageSubscriptionButton />);
    fireEvent.click(screen.getByRole("button", { name: "구독 관리" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(billingErrorMessage("TEMPORARY_FAILURE"));
    expect(screen.getByRole("button", { name: "구독 관리" })).toBeEnabled();
  });
});
