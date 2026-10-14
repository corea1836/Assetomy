import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataNotice } from "./data-notice";

describe("DataNotice", () => {
  it("always shows both privacy notices as captions", () => {
    const { container } = render(<DataNotice />);
    for (const text of [
      "분석을 위해 가맹점명과 집계 결과, 내가 남긴 요약 피드백이 AI 서비스로 전송됩니다.",
      "원본 파일은 암호화해 보관하고, 거래는 이용일 기준 12개월 뒤 삭제됩니다.",
    ]) expect(screen.getByText(text)).toBeVisible();
    expect(container.firstElementChild).toHaveClass("text-caption", "text-body");
    expect(container.querySelector("details, [hidden]")).toBeNull();
  });
});
