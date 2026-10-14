import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardOption } from "@/types/upload";
import { cardEditErrorMessage } from "@/lib/errors/messages";
import { CardEditButton } from "./card-edit-dialog";

const navigation = { refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const fetchMock = vi.fn<typeof fetch>();

const card: CardOption = {
  id: "card/1", label: "생활비 카드", issuer: "hyundai", analysisBasis: "cycle", cycleStartDay: 12,
};

beforeEach(() => {
  fetchMock.mockReset();
  navigation.refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function openDialog() {
  render(<CardEditButton card={card} />);
  const opener = screen.getByRole("button", { name: "카드 수정" });
  fireEvent.click(opener);
  return { opener, dialog: screen.getByRole("dialog", { name: "카드 수정" }) };
}

describe("CardEditButton", () => {
  it("opens with current values, issuer text, and the cycle help", () => {
    openDialog();

    expect(screen.getByText("카드사 현대카드 · 바꿀 수 없어요")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "카드 이름" })).toHaveValue("생활비 카드");
    expect(screen.getByRole("radio", { name: "이용 기간" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "이용 기간 시작일" })).toHaveValue("12");
    expect(screen.getByText("12일부터 다음 달 11일까지를 한 명세서로 봐요")).toBeInTheDocument();
  });

  it("shows the summary refresh note after changing the basis", () => {
    openDialog();
    fireEvent.click(screen.getByRole("radio", { name: "월별" }));

    expect(screen.getByText("분석 기준을 바꾸면 이 카드 요약을 다시 만들어요")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "이용 기간 시작일" })).not.toBeInTheDocument();
  });

  it("sends editable fields only and closes with a refresh on success", async () => {
    fetchMock.mockResolvedValue(Response.json({ updated: true }));
    openDialog();
    fireEvent.change(screen.getByRole("textbox", { name: "카드 이름" }), { target: { value: "새 생활비" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/cards/card%2F1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "새 생활비", analysisBasis: "cycle", cycleStartDay: 12 }),
    });
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("maps a duplicate label response to the label field", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: "DUPLICATE_LABEL" } }, { status: 409 }));
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    const message = await screen.findByText(cardEditErrorMessage("DUPLICATE_LABEL"));
    expect(message).toHaveClass("text-sm", "text-danger");
    expect(screen.getByRole("textbox", { name: "카드 이름" })).toHaveAttribute("aria-describedby", message.id);
  });

  it("maps an invalid cycle response to the basis field", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: "INVALID_CARD" } }, { status: 400 }));
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    const message = await screen.findByText(cardEditErrorMessage("INVALID_CARD"));
    expect(screen.getByRole("textbox", { name: "이용 기간 시작일" })).toHaveAttribute("aria-describedby", message.id);
  });

  it("shows a retry message when the request fails", async () => {
    fetchMock.mockRejectedValue(new Error("private network response"));
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText(cardEditErrorMessage("TEMPORARY_FAILURE"))).toHaveAttribute("role", "alert");
  });

  it("disables the form and sends only once while saving", async () => {
    let resolve: ((response: Response) => void) | undefined;
    fetchMock.mockReturnValue(new Promise((res) => { resolve = res; }));
    openDialog();
    const save = screen.getByRole("button", { name: "저장" });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(save).toBeDisabled();
    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "카드 이름" })).toBeDisabled();
    resolve?.(Response.json({ updated: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes on Escape and returns focus to the opener", async () => {
    const { opener, dialog } = openDialog();
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it.each([
    { name: "a long label", edit: () => fireEvent.change(screen.getByRole("textbox", { name: "카드 이름" }), { target: { value: "가".repeat(31) } }), expected: "INVALID_LABEL" },
    { name: "a cycle day of zero", edit: () => fireEvent.change(screen.getByRole("textbox", { name: "이용 기간 시작일" }), { target: { value: "0" } }), expected: "INVALID_CARD" },
  ])("does not send invalid input: $name", async ({ edit, expected }) => {
    openDialog();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText(cardEditErrorMessage(expected))).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
