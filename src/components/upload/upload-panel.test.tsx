import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadErrorMessage } from "@/lib/errors/messages";
import type { CardOption, UploadResultDto } from "@/types/upload";
import { HyundaiGuide } from "./hyundai-guide";
import { sendUpload } from "./send-upload";
import { UploadPanel } from "./upload-panel";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("./send-upload", () => ({ sendUpload: vi.fn() }));

const cards: CardOption[] = [{ id: "card-a", label: "현대 생활비", issuer: "hyundai", analysisBasis: "month", cycleStartDay: null }];
const fetchMock = vi.fn<typeof fetch>();
type Reply = Awaited<ReturnType<typeof sendUpload>>;
const done: UploadResultDto = {
  kind: "done", uploadId: "upload-a", inserted: 2, duplicates: 0, skipped: 0,
  periodFrom: "2026-09-01", periodTo: "2026-09-30", netAmount: 32_000,
  statementDate: "2026-10-23", replaced: false,
};
const noNew: UploadResultDto = {
  kind: "no_new", uploadId: "upload-b", inserted: 0, duplicates: 2, skipped: 0,
  periodFrom: null, periodTo: null, netAmount: 0, statementDate: null, replaced: false,
};
const success = (result: UploadResultDto = done): Reply => ({ status: 200, body: { result } });
const pdf = (name = "9월.pdf") => new File(["%PDF-"], name, { type: "application/pdf" });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function addFiles(files: File[]) {
  const input = screen.getByLabelText(screen.queryByRole("button", { name: "파일 선택" }) ? "파일 선택" : "파일 추가");
  fireEvent.change(input, { target: { files } });
}

function row(name: string) {
  return screen.getByText(name).closest("li")!;
}

function chooseCards() {
  for (const select of screen.getAllByRole("combobox", { name: "카드" })) {
    fireEvent.change(select, { target: { value: "card-a" } });
  }
}

async function upload(files = [pdf()], result: UploadResultDto = done) {
  vi.mocked(sendUpload).mockResolvedValue(success(result));
  addFiles(files);
  chooseCards();
  fireEvent.click(screen.getByRole("button", { name: "올리기" }));
  await waitFor(() => expect(within(row(files[0].name)).getByText("완료")).toBeInTheDocument());
}

beforeEach(() => {
  vi.mocked(sendUpload).mockReset();
  fetchMock.mockReset();
  navigation.refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("UploadPanel file and card selection", () => {
  it("offers a keyboard button and a labeled PDF-only multiple file input with visible notices", () => {
    const { container } = render(<UploadPanel cards={cards} />);
    const button = screen.getByRole("button", { name: "파일 선택" });
    expect(button).toHaveClass("bg-primary", "h-11", "focus-visible:outline-primary");
    const input = screen.getByLabelText("파일 선택");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("multiple");
    expect(input).toHaveAttribute("accept", ".pdf,application/pdf");
    const open = vi.spyOn(input as HTMLInputElement, "click");
    button.focus();
    fireEvent.click(button);
    expect(open).toHaveBeenCalledOnce();
    expect(screen.getByText("파일당 4MB · 최근 24시간 30개 · 동시에 2개씩 처리해요")).toBeVisible();
    expect(screen.getByText("여러 카드가 섞인 파일은 카드별로 다시 받아 주세요")).toBeVisible();
    expect(screen.getByText("기간이 겹쳐도 같은 거래는 한 번만 반영돼요")).toBeVisible();
    expect(screen.getByText("분석을 위해 가맹점명과 집계 결과가 AI 서비스로 전송됩니다.")).toBeVisible();
    expect(screen.getByText("원본 파일은 암호화해 보관하고, 거래는 이용일 기준 12개월 뒤 삭제됩니다.")).toBeVisible();
    expect(screen.getAllByText(/암호화/)).toHaveLength(1);
    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(container).not.toHaveTextContent(/지금 바로|놓치지 마세요|!/);
  });

  it("rejects csv and files over 4MB on their rows while uploading the valid uppercase PDF", async () => {
    render(<UploadPanel cards={cards} />);
    const oversized = pdf("큰파일.pdf");
    Object.defineProperty(oversized, "size", { value: 4_194_305 });
    addFiles([new File(["date"], "내역.csv"), oversized, pdf("유효.PDF")]);
    expect(within(row("내역.csv")).getByText(uploadErrorMessage("UNSUPPORTED_FILE", "not_pdf"))).toBeInTheDocument();
    expect(within(row("큰파일.pdf")).getByText(uploadErrorMessage("FILE_TOO_LARGE"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "파일 추가" })).toHaveClass("bg-surface-strong");
    expect(screen.getByRole("button", { name: "올리기" })).toHaveClass("bg-primary");
    chooseCards();
    vi.mocked(sendUpload).mockResolvedValue(success());
    fireEvent.click(screen.getByRole("button", { name: "올리기" }));
    await waitFor(() => expect(sendUpload).toHaveBeenCalledOnce());
    expect(vi.mocked(sendUpload).mock.calls[0][0].get("file")).toHaveProperty("name", "유효.PDF");
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledOnce());
  });

  it("accepts exactly 4MB and never picks the only card automatically", () => {
    render(<UploadPanel cards={cards} />);
    const file = pdf();
    Object.defineProperty(file, "size", { value: 4_194_304 });
    addFiles([file, pdf("10월.pdf")]);
    const selects = screen.getAllByRole("combobox", { name: "카드" });
    expect(selects).toHaveLength(2);
    for (const select of selects) expect(select).toHaveValue("");
    expect(screen.getByRole("button", { name: "올리기" })).toBeDisabled();
    expect(screen.getByText("카드를 고르지 않은 파일이 2개 있어요")).toBeInTheDocument();
    fireEvent.change(selects[0], { target: { value: "card-a" } });
    expect(screen.getByText("카드를 고르지 않은 파일이 1개 있어요")).toBeInTheDocument();
    fireEvent.change(selects[1], { target: { value: "card-a" } });
    expect(screen.getByRole("button", { name: "올리기" })).toBeEnabled();
    expect(screen.queryByText(/카드를 고르지 않은 파일/)).not.toBeInTheDocument();
  });

  it("removes a waiting file with a secondary button", () => {
    render(<UploadPanel cards={cards} />);
    addFiles([pdf()]);
    const remove = screen.getByRole("button", { name: "빼기" });
    expect(remove).toHaveClass("bg-surface-strong", "h-9");
    fireEvent.click(remove);
    expect(screen.queryByText("9월.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "파일 선택" })).toHaveClass("bg-primary");
  });

  it("adds a complete card, selects it only in that row, and shares it with other rows", async () => {
    render(<UploadPanel cards={cards} />);
    addFiles([pdf(), pdf("10월.pdf")]);
    const select = within(row("9월.pdf")).getByRole("combobox", { name: "카드" });
    const newOption = within(select).getByRole("option", { name: "새 카드 추가" });
    fireEvent.change(select, { target: { value: newOption.getAttribute("value") } });
    const label = within(row("9월.pdf")).getByRole("textbox", { name: "카드 이름" });
    expect(label).toHaveValue("현대카드 2");
    fireEvent.change(within(row("9월.pdf")).getByRole("combobox", { name: "카드사" }), { target: { value: "shinhan" } });
    expect(label).toHaveValue("신한카드 1");
    const response = deferred<Response>();
    fetchMock.mockReturnValue(response.promise);
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    expect(screen.getByRole("button", { name: "추가 중…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "올리기" })).toBeDisabled();
    expect(within(row("9월.pdf")).getByRole("button", { name: "빼기" })).toBeDisabled();
    await act(async () => response.resolve(Response.json({
      card: { id: "card-b", label: "신한카드 1", issuer: "shinhan", analysisBasis: "month", cycleStartDay: null },
    }, { status: 201 })));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/cards", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "신한카드 1", issuer: "shinhan", analysisBasis: "month", cycleStartDay: null }),
    });
    await waitFor(() => expect(select).toHaveValue("card-b"));
    const other = within(row("10월.pdf")).getByRole("combobox", { name: "카드" });
    expect(within(other).getByRole("option", { name: "신한카드 1" })).toBeInTheDocument();
    expect(other).toHaveValue("");
  });

  it("shows the new card name field directly when no card exists, then switches rows to the card select", async () => {
    render(<UploadPanel cards={[]} />);
    addFiles([pdf(), pdf("10월.pdf")]);
    expect(screen.queryByRole("combobox", { name: "카드" })).not.toBeInTheDocument();
    const label = within(row("9월.pdf")).getByRole("textbox", { name: "카드 이름" });
    expect(label).toHaveValue("현대카드 1");
    expect(within(row("10월.pdf")).getByRole("textbox", { name: "카드 이름" })).toBeInTheDocument();
    fetchMock.mockResolvedValue(Response.json({
      card: { id: "card-b", label: "현대카드 1", issuer: "hyundai", analysisBasis: "month", cycleStartDay: null },
    }, { status: 201 }));
    fireEvent.click(within(row("9월.pdf")).getByRole("button", { name: "추가" }));
    await waitFor(() => expect(within(row("9월.pdf")).getByRole("combobox", { name: "카드" })).toHaveValue("card-b"));
    const other = within(row("10월.pdf")).getByRole("combobox", { name: "카드" });
    expect(other).toHaveValue("");
    expect(within(other).getByRole("option", { name: "현대카드 1" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "카드 이름" })).not.toBeInTheDocument();
    fireEvent.change(other, { target: { value: "card-b" } });
    expect(screen.getByRole("button", { name: "올리기" })).toBeEnabled();
  });

  it("updates another open new-card form when a card is created", async () => {
    render(<UploadPanel cards={cards} />);
    addFiles([pdf(), pdf("10월.pdf")]);
    for (const item of [row("9월.pdf"), row("10월.pdf")]) {
      const select = within(item).getByRole("combobox", { name: "카드" });
      fireEvent.change(select, { target: { value: within(select).getByRole("option", { name: "새 카드 추가" }).getAttribute("value") } });
    }
    expect(within(row("9월.pdf")).getByRole("textbox", { name: "카드 이름" })).toHaveValue("현대카드 2");
    expect(within(row("10월.pdf")).getByRole("textbox", { name: "카드 이름" })).toHaveValue("현대카드 2");
    fetchMock.mockResolvedValue(Response.json({ card: {
      id: "card-b", label: "현대카드 2", issuer: "hyundai", analysisBasis: "month", cycleStartDay: null,
    } }, { status: 201 }));
    fireEvent.click(within(row("9월.pdf")).getByRole("button", { name: "추가" }));
    await waitFor(() => expect(within(row("10월.pdf")).getByRole("textbox", { name: "카드 이름" })).toHaveValue("현대카드 3"));
  });

  it("keeps card creation failure beside that row", async () => {
    render(<UploadPanel cards={cards} />);
    addFiles([pdf()]);
    const select = screen.getByRole("combobox", { name: "카드" });
    fireEvent.change(select, { target: { value: within(select).getByRole("option", { name: "새 카드 추가" }).getAttribute("value") } });
    fetchMock.mockResolvedValue(Response.json({ error: { code: "DUPLICATE_LABEL" } }, { status: 409 }));
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    expect(await within(row("9월.pdf")).findByText(uploadErrorMessage("DUPLICATE_LABEL"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "올리기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "추가" })).toBeEnabled();
  });
});

describe("UploadPanel processing", () => {
  it("runs at most two requests, reports transfer and analysis, and refreshes once after all rows finish", async () => {
    render(<UploadPanel cards={cards} />);
    const pending = [deferred<Reply>(), deferred<Reply>(), deferred<Reply>()];
    const onSent: (() => void)[] = [];
    let active = 0;
    let maximum = 0;
    vi.mocked(sendUpload).mockImplementation((_form, callback) => {
      const index = onSent.length;
      onSent.push(callback);
      maximum = Math.max(maximum, ++active);
      return pending[index].promise.finally(() => { active--; });
    });
    addFiles([pdf("1.pdf"), pdf("2.pdf"), pdf("3.pdf")]);
    chooseCards();
    fireEvent.click(screen.getByRole("button", { name: "올리기" }));
    expect(sendUpload).toHaveBeenCalledTimes(2);
    expect(within(row("1.pdf")).getByText("올리는 중")).toBeInTheDocument();
    expect(within(row("2.pdf")).getByText("올리는 중")).toBeInTheDocument();
    expect(within(row("3.pdf")).getByText("대기")).toBeInTheDocument();
    act(() => onSent[0]());
    expect(within(row("1.pdf")).getByText("분석 중")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "올리기" })).toBeDisabled();
    await act(async () => pending[0].resolve(success()));
    expect(sendUpload).toHaveBeenCalledTimes(3);
    expect(navigation.refresh).not.toHaveBeenCalled();
    await act(async () => pending[1].resolve(success(noNew)));
    expect(navigation.refresh).not.toHaveBeenCalled();
    await act(async () => pending[2].resolve(success()));
    expect(maximum).toBe(2);
    expect(navigation.refresh).toHaveBeenCalledOnce();
    for (let index = 0; index < 3; index++) {
      const form = vi.mocked(sendUpload).mock.calls[index][0];
      expect(form.get("cardId")).toBe("card-a");
      expect(form.get("file")).toHaveProperty("name", `${index + 1}.pdf`);
      expect([...form.keys()]).toEqual(["cardId", "file"]);
    }
  });

  it.each([
    [done, "10월 23일 명세서 · 2건 · 9/1~9/30 · 지출 32,000원"],
    [{ ...done, duplicates: 3, skipped: 1 }, "10월 23일 명세서 · 2건 · 9/1~9/30 · 지출 32,000원 · 중복 3건 · 제외 1건"],
    [noNew, "이미 올린 내역이에요"],
    [{ ...noNew, skipped: 2 }, "이미 올린 내역이에요 · 12개월이 지난 거래 2건 제외"],
    [{ kind: "older_statement" }, "더 최근에 받은 명세서가 이미 있어요. 이 파일은 저장하지 않았어요"],
    [{ kind: "duplicate", existingCardLabel: null }, "이미 올린 내역이에요"],
  ] satisfies [UploadResultDto, string][])("shows the result for %j", async (result, text) => {
    render(<UploadPanel cards={cards} />);
    await upload([pdf()], result);
    expect(within(row("9월.pdf")).getByText(text)).toBeInTheDocument();
    expect(within(row("9월.pdf")).getByText("완료")).toHaveClass("text-primary");
    expect(within(row("9월.pdf")).queryByRole("button", { name: "틀렸어요" }) !== null).toBe(result.kind === "done");
    expect(navigation.refresh).toHaveBeenCalledTimes(result.kind === "done" ? 1 : 0);
  });

  it("shows a statement replacement note below the result line", async () => {
    render(<UploadPanel cards={cards} />);
    await upload([pdf()], { ...done, replaced: true });
    const item = within(row("9월.pdf"));
    expect(item.getByText("10월 23일 명세서 · 2건 · 9/1~9/30 · 지출 32,000원")).toBeInTheDocument();
    expect(item.getByText("이전에 올린 같은 명세서를 이 파일로 바꿨어요")).toHaveClass("text-sm", "text-body");
  });

  it("does not refresh for an older statement result", async () => {
    render(<UploadPanel cards={cards} />);
    await upload([pdf()], { kind: "older_statement" });
    expect(within(row("9월.pdf")).getByText("더 최근에 받은 명세서가 이미 있어요. 이 파일은 저장하지 않았어요")).toBeInTheDocument();
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("explains a duplicate under a different card label as plain text", async () => {
    render(<UploadPanel cards={cards} />);
    const label = "<script>온라인 카드</script>";
    await upload([pdf()], { kind: "duplicate", existingCardLabel: label });
    expect(within(row("9월.pdf")).getByText(`'${label}' 카드로 올렸던 파일이에요. 카드를 잘못 지정했다면 기존 업로드를 삭제하고 다시 올려 주세요`)).toBeInTheDocument();
    expect(row("9월.pdf").querySelector("script")).toBeNull();
  });

  it("omits the different-card explanation for the same card", async () => {
    render(<UploadPanel cards={cards} />);
    await upload([pdf()], { kind: "duplicate", existingCardLabel: cards[0].label });
    expect(screen.queryByText(/카드로 올렸던 파일/)).not.toBeInTheDocument();
  });

  it("retries a temporary failure with the same file and selected card", async () => {
    render(<UploadPanel cards={cards} />);
    const file = pdf();
    vi.mocked(sendUpload).mockResolvedValueOnce({ status: 503, body: { error: { code: "TEMPORARY_FAILURE" } } }).mockResolvedValueOnce(success());
    addFiles([file]);
    chooseCards();
    fireEvent.click(screen.getByRole("button", { name: "올리기" }));
    const retry = await screen.findByRole("button", { name: "다시 시도" });
    expect(within(row(file.name)).getByText(uploadErrorMessage("TEMPORARY_FAILURE"))).toBeInTheDocument();
    expect(navigation.refresh).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(screen.getByRole("combobox", { name: "카드" })).toHaveValue("card-a");
    fireEvent.click(screen.getByRole("button", { name: "올리기" }));
    await waitFor(() => expect(sendUpload).toHaveBeenCalledTimes(2));
    const first = vi.mocked(sendUpload).mock.calls[0][0];
    const second = vi.mocked(sendUpload).mock.calls[1][0];
    expect(second.get("file")).toBe(first.get("file"));
    expect(second.get("cardId")).toBe(first.get("cardId"));
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledOnce());
  });

  it.each([
    { status: 0, body: null },
    { status: 503, body: "<html>unavailable</html>" },
    { status: 400, body: { error: { code: "UNKNOWN", message: "private error" } } },
    { status: 200, body: { result: { kind: "unexpected" } } },
  ])("uses the temporary message for malformed response %j", async (reply) => {
    render(<UploadPanel cards={cards} />);
    vi.mocked(sendUpload).mockResolvedValue(reply);
    addFiles([pdf()]); chooseCards();
    fireEvent.click(screen.getByRole("button", { name: "올리기" }));
    expect(await screen.findByText(uploadErrorMessage("TEMPORARY_FAILURE"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(screen.queryByText("private error")).not.toBeInTheDocument();
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("opens the guide, focuses its summary, and scrolls for an unreadable PDF", async () => {
    render(<><HyundaiGuide /><UploadPanel cards={cards} /></>);
    const summary = screen.getByText("현대카드 이용내역 받는 법");
    const scroll = vi.fn();
    summary.scrollIntoView = scroll;
    vi.mocked(sendUpload).mockResolvedValue({ status: 422, body: { error: { code: "UNREADABLE", reason: "total_mismatch" } } });
    addFiles([pdf()]); chooseCards();
    fireEvent.click(screen.getByRole("button", { name: "올리기" }));
    expect(await screen.findByText(uploadErrorMessage("UNREADABLE", "total_mismatch"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "가이드 열기" }));
    expect(summary.closest("details")).toHaveAttribute("open");
    expect(summary).toHaveFocus();
    expect(scroll).toHaveBeenCalledOnce();
  });

  it("does not offer a missing guide", () => {
    render(<UploadPanel cards={cards} />);
    addFiles([new File(["x"], "bad.csv")]);
    expect(screen.queryByRole("button", { name: "가이드 열기" })).not.toBeInTheDocument();
  });

  it.each(["CARD_NOT_FOUND", "CARD_SCOPE_MISMATCH", "CARD_MISMATCH"] as const)("clears the card for %s", async (code) => {
    render(<UploadPanel cards={cards} />);
    vi.mocked(sendUpload).mockResolvedValue({ status: code === "CARD_MISMATCH" ? 409 : 404,
      body: { error: { code, ...(code === "CARD_MISMATCH" ? { reason: "issuer" } : {}) } } });
    addFiles([pdf()]); chooseCards();
    fireEvent.click(screen.getByRole("button", { name: "올리기" }));
    if (code === "CARD_MISMATCH") {
      expect(await screen.findByText(uploadErrorMessage("CARD_MISMATCH", "issuer"))).toBeInTheDocument();
    }
    fireEvent.click(await screen.findByRole("button", { name: "카드 다시 고르기" }));
    expect(screen.getByRole("combobox", { name: "카드" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "올리기" })).toBeDisabled();
  });

  it("offers login after a session expires", async () => {
    render(<UploadPanel cards={cards} />);
    vi.mocked(sendUpload).mockResolvedValue({ status: 401, body: { error: { code: "UNAUTHORIZED" } } });
    addFiles([pdf()]); chooseCards();
    fireEvent.click(screen.getByRole("button", { name: "올리기" }));
    expect(await screen.findByRole("link", { name: "다시 로그인" })).toHaveAttribute("href", "/login?next=%2Fdashboard");
  });
});

describe("UploadPanel undo dialog", () => {
  async function openDialog() {
    render(<UploadPanel cards={cards} />);
    await upload();
    const opener = screen.getByRole("button", { name: "틀렸어요" });
    fireEvent.click(opener);
    return { opener, dialog: screen.getByRole("dialog", { name: "이 업로드를 삭제할까요?" }) };
  }

  it("focuses the dialog, traps Tab, and restores focus on Escape or cancel without a Primary button", async () => {
    const { opener, dialog } = await openDialog();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(dialog).toHaveTextContent("이 파일로 처음 저장된 거래 2건을 지워요. 다른 파일과 겹쳐서 제외됐던 거래는 되살아나지 않으니, 필요하면 그 파일을 다시 올려 주세요.");
    for (const button of within(dialog).getAllByRole("button")) expect(button).not.toHaveClass("bg-primary");
    const remove = within(dialog).getByRole("button", { name: "삭제" });
    const cancel = within(dialog).getByRole("button", { name: "취소" });
    expect(remove).toHaveClass("text-danger", "bg-surface-strong");
    expect(cancel).toHaveClass("bg-surface-strong");
    const buttons = within(dialog).getAllByRole("button");
    buttons[buttons.length - 1].focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(buttons[buttons.length - 1]).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(opener).toHaveFocus();
  });

  it("deletes via the upload endpoint, disables actions while pending, then refreshes", async () => {
    const { dialog } = await openDialog();
    navigation.refresh.mockClear();
    const response = deferred<Response>();
    fetchMock.mockReturnValue(response.promise);
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/uploads/upload-a", { method: "DELETE" });
    for (const button of within(dialog).getAllByRole("button")) expect(button).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog).toBeInTheDocument();
    await act(async () => response.resolve(Response.json({ deleted: true })));
    expect(await within(row("9월.pdf")).findByText("삭제했어요")).toHaveClass("text-body");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("keeps deletion errors in an alert and allows another attempt", async () => {
    const { dialog } = await openDialog();
    navigation.refresh.mockClear();
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "UPLOAD_PROCESSING" } }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ deleted: true }));
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(uploadErrorMessage("UPLOAD_PROCESSING"));
    expect(within(dialog).getByRole("button", { name: "삭제" })).toBeEnabled();
    expect(navigation.refresh).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });
});
