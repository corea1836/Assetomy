import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TipFeedback } from "./tip-feedback";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  return { status, json: async () => body };
}

beforeEach(() => {
  mocks.refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TipFeedback", () => {
  it("shows a quiet add button when no feedback exists", () => {
    render(<TipFeedback category="food" initial="" />);

    const button = screen.getByRole("button", { name: "피드백 남기기" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveClass("text-body", "hover:underline");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows existing feedback as text with an edit button", () => {
    const markup = "<b>평일에는 커피를 마셔요</b>";
    const { container } = render(<TipFeedback category="cafe" initial={markup} />);

    expect(screen.getByText(`내 피드백: ${markup}`)).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByRole("button", { name: "수정" })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a focused form with normalized character count and both notices", async () => {
    render(<TipFeedback category="food" initial="  한 잔  " />);
    fireEvent.click(screen.getByRole("button", { name: "수정" }));

    const input = screen.getByRole("textbox", { name: "식비 피드백" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("  한 잔  ");
    expect(input).toHaveAttribute("maxLength", "100");
    expect(screen.getByText("피드백은 AI 요약에 함께 보내져요. 개인정보는 적지 마세요")).toBeInTheDocument();
    expect(screen.getByText("비우고 저장하면 피드백을 지워요")).toBeInTheDocument();
    expect(screen.getByText("3/100")).toHaveClass("tabular-nums", "text-body");
  });

  it("saves the category feedback as JSON, closes, announces success and refreshes", async () => {
    fetchMock.mockResolvedValue(reply(200, { saved: true }));
    render(<TipFeedback category="grocery" initial="" />);
    const opener = screen.getByRole("button", { name: "피드백 남기기" });
    fireEvent.click(opener);
    fireEvent.change(screen.getByRole("textbox", { name: "마트·생활 피드백" }), {
      target: { value: "  평일 오전 커피라 줄이기 어려워요  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/summary-feedback", expect.objectContaining({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "grocery", text: "  평일 오전 커피라 줄이기 어려워요  " }),
    })));
    expect(await screen.findByText("저장했어요")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("announces deletion when the cleared value is saved", async () => {
    fetchMock.mockResolvedValue(reply(200, { deleted: true }));
    render(<TipFeedback category="food" initial="기존 피드백" />);
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.change(screen.getByRole("textbox", { name: "식비 피드백" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("피드백을 지웠어요")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("button", { name: "피드백 남기기" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/summary-feedback", expect.objectContaining({
      body: JSON.stringify({ category: "food", text: "" }),
    }));
  });

  it("shows a mapped error and connects it to the invalid input", async () => {
    fetchMock.mockResolvedValue(reply(400, { error: { code: "BAD_REQUEST" } }));
    render(<TipFeedback category="food" initial="" />);
    fireEvent.click(screen.getByRole("button", { name: "피드백 남기기" }));
    const input = screen.getByRole("textbox", { name: "식비 피드백" });
    fireEvent.change(input, { target: { value: "테스트 입력" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    const error = await screen.findByText("피드백은 100자까지 쓸 수 있어요.");
    expect(error).toHaveClass("text-sm", "text-danger");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", error.id);
  });

  it("ignores duplicate submits while a request is pending", async () => {
    let resolveReply: (value: ReturnType<typeof reply>) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise((resolve) => { resolveReply = resolve; }));
    render(<TipFeedback category="food" initial="" />);
    fireEvent.click(screen.getByRole("button", { name: "피드백 남기기" }));
    fireEvent.change(screen.getByRole("textbox", { name: "식비 피드백" }), { target: { value: "피드백" } });
    const save = screen.getByRole("button", { name: "저장" });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    resolveReply(reply(200, { saved: true }));
    expect(await screen.findByText("저장했어요")).toBeInTheDocument();
  });

  it("restores the initial value and opener focus on cancel", async () => {
    render(<TipFeedback category="food" initial="기존 피드백" />);
    const opener = screen.getByRole("button", { name: "수정" });
    fireEvent.click(opener);
    const input = screen.getByRole("textbox", { name: "식비 피드백" });
    fireEvent.change(input, { target: { value: "바꾼 내용" } });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.getByText("내 피드백: 기존 피드백")).toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
    fireEvent.click(opener);
    expect(screen.getByRole("textbox", { name: "식비 피드백" })).toHaveValue("기존 피드백");
  });

  it("uses refreshed server feedback for the closed display and next edit", () => {
    const { rerender } = render(<TipFeedback category="food" initial="처음 피드백" />);
    rerender(<TipFeedback category="food" initial="새 서버 피드백" />);

    expect(screen.getByText("내 피드백: 새 서버 피드백")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    expect(screen.getByRole("textbox", { name: "식비 피드백" })).toHaveValue("새 서버 피드백");
  });

  it("does not write feedback text to the console", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(reply(400, { error: { code: "BAD_REQUEST" } }));
    render(<TipFeedback category="food" initial="" />);
    fireEvent.click(screen.getByRole("button", { name: "피드백 남기기" }));
    fireEvent.change(screen.getByRole("textbox", { name: "식비 피드백" }), { target: { value: "민감한 피드백 문자열" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("피드백은 100자까지 쓸 수 있어요.");

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
