import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadErrorMessage } from "@/lib/errors/messages";
import type { CardOption } from "@/types/upload";
import { CardForm } from "./card-form";

const fetchMock = vi.fn<typeof fetch>();
const created: CardOption = {
  id: "card-created", label: "현대카드 1", issuer: "hyundai", analysisBasis: "month", cycleStartDay: null,
};
const existing: CardOption = {
  id: "card-existing", label: "내 현대", issuer: "hyundai", analysisBasis: "month", cycleStartDay: null,
};

function props(cards: CardOption[] = []) {
  return { cards, disabled: false, onPendingChange: vi.fn(), onCreated: vi.fn() };
}

function chooseCycle() {
  fireEvent.click(screen.getByRole("radio", { name: "이용 기간" }));
}

function fillCycleDay(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "이용 기간 시작일" }), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("CardForm", () => {
  it("starts with Hyundai, its next label, and monthly analysis", () => {
    render(<CardForm {...props()} />);
    expect(screen.getByRole("combobox", { name: "카드사" })).toHaveValue("hyundai");
    expect(screen.getByRole("textbox", { name: "카드 이름" })).toHaveValue("현대카드 1");
    expect(screen.getByRole("radio", { name: "월별" })).toBeChecked();
    expect(screen.queryByRole("textbox", { name: "이용 기간 시작일" })).not.toBeInTheDocument();
  });

  it("updates the suggested label with issuer until the user edits it", () => {
    render(<CardForm {...props()} />);
    const issuer = screen.getByRole("combobox", { name: "카드사" });
    const label = screen.getByRole("textbox", { name: "카드 이름" });
    fireEvent.change(issuer, { target: { value: "shinhan" } });
    expect(label).toHaveValue("신한카드 1");
    fireEvent.change(label, { target: { value: "생활비카드" } });
    fireEvent.change(issuer, { target: { value: "samsung" } });
    expect(label).toHaveValue("생활비카드");
  });

  it("uses the current cards to suggest the next label", () => {
    const formProps = props([existing]);
    const { rerender } = render(<CardForm {...formProps} />);
    expect(screen.getByRole("textbox", { name: "카드 이름" })).toHaveValue("현대카드 2");
    rerender(<CardForm {...formProps} cards={[...formProps.cards, { ...created, id: "second" }]} />);
    expect(screen.getByRole("textbox", { name: "카드 이름" })).toHaveValue("현대카드 3");
  });

  it("shows the cycle day help and adjusts it for day 12 and day 1", () => {
    render(<CardForm {...props()} />);
    chooseCycle();
    expect(screen.getByRole("textbox", { name: "이용 기간 시작일" })).toBeInTheDocument();
    expect(screen.getByText("12일이면 12일부터 다음 달 11일까지를 한 명세서로 봐요")).toBeInTheDocument();
    fillCycleDay("12");
    expect(screen.getByText("12일부터 다음 달 11일까지를 한 명세서로 봐요")).toBeInTheDocument();
    fillCycleDay("1");
    expect(screen.getByText("1일부터 그달 말일까지를 한 명세서로 봐요")).toBeInTheDocument();
  });

  it.each(["0", "32", "", "1.5", "12일", " 12"]) (
    "rejects invalid cycle start day %j before requesting",
    async (value) => {
      render(<CardForm {...props()} />);
      chooseCycle();
      fillCycleDay(value);
      submit();
      expect(await screen.findByText(uploadErrorMessage("INVALID_CARD"))).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByRole("textbox", { name: "이용 기간 시작일" })).toHaveAttribute("aria-describedby");
    },
  );

  it("rejects an empty card name before requesting", async () => {
    render(<CardForm {...props()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "카드 이름" }), { target: { value: "   " } });
    submit();
    expect(await screen.findByText(uploadErrorMessage("INVALID_LABEL"))).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "카드 이름" })).toHaveAttribute("aria-describedby");
  });

  it("sends monthly card fields, reports pending, and returns a valid created card", async () => {
    const callbacks = props();
    fetchMock.mockResolvedValue(Response.json({ card: created }, { status: 201 }));
    render(<CardForm {...callbacks} />);
    submit();
    await waitFor(() => expect(callbacks.onCreated).toHaveBeenCalledWith(created));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "현대카드 1", issuer: "hyundai", analysisBasis: "month", cycleStartDay: null }),
    });
    expect(callbacks.onPendingChange.mock.calls).toEqual([[true], [false]]);
  });

  it("sends a cycle basis and numeric start day", async () => {
    const callbacks = props();
    const cycleCard = { ...created, analysisBasis: "cycle" as const, cycleStartDay: 12 };
    fetchMock.mockResolvedValue(Response.json({ card: cycleCard }, { status: 201 }));
    render(<CardForm {...callbacks} />);
    chooseCycle();
    fillCycleDay("12");
    submit();
    await waitFor(() => expect(callbacks.onCreated).toHaveBeenCalledWith(cycleCard));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "현대카드 1", issuer: "hyundai", analysisBasis: "cycle", cycleStartDay: 12 }),
    });
  });

  it.each([
    { status: 409, body: { error: { code: "DUPLICATE_LABEL" } }, code: "DUPLICATE_LABEL" as const },
    { status: 400, body: { error: { code: "INVALID_CARD" } }, code: "INVALID_CARD" as const },
    { status: 503, body: { error: { code: "TEMPORARY_FAILURE" } }, code: "TEMPORARY_FAILURE" as const },
  ])("shows the server error $code without creating a card", async ({ status, body, code }) => {
    const callbacks = props();
    fetchMock.mockResolvedValue(Response.json(body, { status }));
    render(<CardForm {...callbacks} />);
    submit();
    expect(await screen.findByText(uploadErrorMessage(code))).toBeInTheDocument();
    expect(callbacks.onCreated).not.toHaveBeenCalled();
    expect(callbacks.onPendingChange.mock.calls).toEqual([[true], [false]]);
  });

  it("associates labels with distinct fields when two forms are rendered", () => {
    const first = props();
    const second = props();
    render(<><CardForm {...first} /><CardForm {...second} /></>);
    fireEvent.click(screen.getAllByRole("radio", { name: "이용 기간" })[0]);
    fireEvent.click(screen.getAllByRole("radio", { name: "이용 기간" })[1]);
    const labels = screen.getAllByRole("textbox", { name: "카드 이름" });
    const issuers = screen.getAllByRole("combobox", { name: "카드사" });
    const cycleDays = screen.getAllByRole("textbox", { name: "이용 기간 시작일" });
    const ids = [...labels, ...issuers, ...cycleDays].map((input) => input.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(ids.length);
    expect(screen.getAllByText("카드 이름")).toHaveLength(2);
  });
});
