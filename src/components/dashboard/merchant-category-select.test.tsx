import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATEGORY_IDS, CATEGORY_LABELS } from "@/types/category";
import { categoryErrorMessage } from "@/lib/errors/messages";
import { MerchantCategorySelect } from "./merchant-category-select";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const fetchMock = vi.fn<typeof fetch>();
const props = { merchantKey: "cafe-key", merchant: "동네 카페", category: "etc" as const };

beforeEach(() => {
  navigation.refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("MerchantCategorySelect", () => {
  it("uses the merchant label, fixed category order and row input styles", () => {
    const { container } = render(<MerchantCategorySelect {...props} />);
    const select = screen.getByRole("combobox", { name: "동네 카페 카테고리" });
    expect(select).toHaveValue("etc");
    expect(select).toHaveClass("h-9", "rounded-lg", "px-3", "text-sm", "border-hairline", "focus:border-primary", "focus:ring-primary");
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.getAttribute("value"))).toEqual(CATEGORY_IDS);
    expect(options.map((option) => option.textContent)).toEqual(CATEGORY_IDS.map((category) => CATEGORY_LABELS[category]));
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent("");
  });

  it("sends JSON, disables during saving, refreshes and announces success", async () => {
    let resolve!: (reply: Response) => void;
    fetchMock.mockReturnValue(new Promise((res) => { resolve = res; }));
    const { container } = render(<MerchantCategorySelect {...props} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "cafe" } });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/merchant-categories", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: '{"merchantKey":"cafe-key","category":"cafe"}',
    });
    expect(select).toBeDisabled();
    expect(select).toHaveValue("cafe");
    expect(navigation.refresh).not.toHaveBeenCalled();
    await act(async () => resolve(Response.json({ updated: 4 })));
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledOnce());
    expect(select).toBeEnabled();
    expect(select).toHaveValue("cafe");
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent("저장했어요");
  });

  it.each([
    { status: 404, code: "NOT_FOUND" as const },
    { status: 503, code: "TEMPORARY_FAILURE" as const },
    { status: 401, code: "UNAUTHORIZED" as const },
  ])("restores the previous value with a mapped message for $status", async ({ status, code }) => {
    fetchMock.mockResolvedValue(Response.json({ error: { code } }, { status }));
    const { container } = render(<MerchantCategorySelect {...props} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cafe" } });
    await screen.findByText(categoryErrorMessage(code));
    expect(screen.getByRole("combobox")).toHaveValue("etc");
    expect(screen.getByRole("combobox")).toBeEnabled();
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(categoryErrorMessage(code));
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("maps network failure without exposing its message, and permits another attempt", async () => {
    fetchMock.mockRejectedValueOnce(new Error("private response"));
    const { container } = render(<MerchantCategorySelect {...props} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cafe" } });
    await screen.findByText(categoryErrorMessage("TEMPORARY_FAILURE"));
    expect(screen.getByRole("combobox")).toHaveValue("etc");
    expect(container).not.toHaveTextContent("private response");
    fetchMock.mockResolvedValueOnce(Response.json({ updated: 1 }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "food" } });
    await screen.findByText("저장했어요");
    expect(screen.getByRole("combobox")).toHaveValue("food");
  });

  it("sends only one request for two rapid changes and ignores a no-op change", async () => {
    let resolve!: (reply: Response) => void;
    fetchMock.mockReturnValue(new Promise((res) => { resolve = res; }));
    render(<MerchantCategorySelect {...props} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "etc" } });
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => {
      fireEvent.change(select, { target: { value: "cafe" } });
      fireEvent.change(select, { target: { value: "food" } });
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(select).toHaveValue("cafe");
    await act(async () => resolve(Response.json({ updated: 1 })));
  });

  it("restores the last saved selection after a later failure", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ updated: 1 }));
    render(<MerchantCategorySelect {...props} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cafe" } });
    await screen.findByText("저장했어요");
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "TEMPORARY_FAILURE" } }, { status: 503 }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "food" } });
    await screen.findByText(categoryErrorMessage("TEMPORARY_FAILURE"));
    expect(screen.getByRole("combobox")).toHaveValue("cafe");
  });

  it("reflects a refreshed category prop and renders markup-looking names as text", () => {
    const merchant = "<img src=x onerror=alert(1)>";
    const view = render(<MerchantCategorySelect {...props} merchant={merchant} />);
    expect(screen.getByLabelText(`${merchant} 카테고리`)).toHaveValue("etc");
    view.rerender(<MerchantCategorySelect {...props} merchant={merchant} category="food" />);
    expect(screen.getByLabelText(`${merchant} 카테고리`)).toHaveValue("food");
    expect(view.container.querySelector("img")).toBeNull();
  });
});
