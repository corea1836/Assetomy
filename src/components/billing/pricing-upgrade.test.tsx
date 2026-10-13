import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PricingUpgrade } from "./pricing-upgrade";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const fetchMock = vi.fn<typeof fetch>();
const assign = vi.fn();

beforeEach(() => {
  navigation.replace.mockReset();
  fetchMock.mockReset();
  assign.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  const testWindow = Object.create(window);
  Object.defineProperty(testWindow, "location", { value: { assign } });
  vi.stubGlobal("window", testWindow);
});
afterEach(() => vi.unstubAllGlobals());

describe("PricingUpgrade", () => {
  it("opens immediately and sends the pricing source when paying", async () => {
    fetchMock.mockResolvedValue(Response.json({ url: "https://polar.test/pricing" }));
    render(<PricingUpgrade />);
    expect(screen.getByRole("dialog")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "결제하기" }));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"source":"pricing"}',
    });
    await waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith("https://polar.test/pricing"));
  });

  it.each(["button", "Escape"])("removes the pricing query after closing with %s", (action) => {
    const { container } = render(<PricingUpgrade />);
    if (action === "button") fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    else fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith("/dashboard");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
