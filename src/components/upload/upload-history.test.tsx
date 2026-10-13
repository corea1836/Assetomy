import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadErrorMessage } from "@/lib/errors/messages";
import type { UploadHistoryItem } from "@/types/upload";
import { UploadHistory } from "./upload-history";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

const fetchMock = vi.fn<typeof fetch>();
const uploads: UploadHistoryItem[] = [
  { id: "upload-b", fileName: "10월.pdf", cardLabel: "현대", inserted: 78, periodFrom: "2026-09-12", periodTo: "2026-10-11" },
  { id: "upload-a", fileName: "<b>9월</b>.pdf", cardLabel: null, inserted: 2, periodFrom: "2026-09-01", periodTo: "2026-09-30" },
];

function item(name: string) {
  return screen.getByText(name).closest("li")!;
}

beforeEach(() => {
  fetchMock.mockReset();
  navigation.refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("UploadHistory", () => {
  it("lists done uploads as text with card, count and period, each with a named delete button", () => {
    const { container } = render(<UploadHistory uploads={uploads} />);
    expect(screen.getByRole("heading", { level: 2, name: "올린 파일" })).toBeInTheDocument();
    const items = within(screen.getByRole("list", { name: "올린 파일" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("10월.pdf")).toBeInTheDocument();
    expect(within(items[0]).getByText("현대")).toBeInTheDocument();
    expect(within(items[0]).getByText("78건 · 9/12~10/11")).toBeInTheDocument();
    expect(within(items[1]).getByText("<b>9월</b>.pdf")).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
    const remove = within(items[0]).getByRole("button", { name: "10월.pdf 삭제" });
    expect(remove).toHaveTextContent("삭제");
    expect(remove).toHaveClass("bg-surface-strong", "h-9");
  });

  it("renders nothing without done uploads", () => {
    const { container } = render(<UploadHistory uploads={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("confirms with the inserted count, restores focus on Escape, then deletes and refreshes", async () => {
    render(<UploadHistory uploads={uploads} />);
    const opener = within(item("10월.pdf")).getByRole("button", { name: "10월.pdf 삭제" });
    fireEvent.click(opener);
    let dialog = screen.getByRole("dialog", { name: "이 업로드를 삭제할까요?" });
    expect(dialog).toHaveTextContent("이 파일로 처음 저장된 거래 78건을 지워요.");
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    dialog = screen.getByRole("dialog", { name: "이 업로드를 삭제할까요?" });
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise((res) => { resolve = res; }));
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/uploads/upload-b", { method: "DELETE" });
    for (const button of within(dialog).getAllByRole("button")) expect(button).toBeDisabled();
    await act(async () => resolve(Response.json({ deleted: true })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(screen.getByText("10월.pdf 삭제했어요")).toHaveClass("sr-only");
  });

  it("keeps a deletion error in the dialog without refreshing", async () => {
    render(<UploadHistory uploads={uploads} />);
    fireEvent.click(within(item("10월.pdf")).getByRole("button", { name: "10월.pdf 삭제" }));
    const dialog = screen.getByRole("dialog", { name: "이 업로드를 삭제할까요?" });
    fetchMock.mockResolvedValue(Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 }));
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(uploadErrorMessage("NOT_FOUND"));
    expect(navigation.refresh).not.toHaveBeenCalled();
  });
});
