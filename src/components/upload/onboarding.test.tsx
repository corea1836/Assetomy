import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Onboarding } from "./onboarding";
import { DataNotice } from "./data-notice";

describe("Onboarding", () => {
  it("explains the first upload in three steps without empty charts or totals", () => {
    const { container } = render(<><Onboarding /><DataNotice /></>);
    expect(screen.getByRole("heading", { level: 1, name: "카드 이용내역을 올려 주세요" })).toBeInTheDocument();
    expect(screen.getByText("최근 3개월치 카드 이용내역을 올리면 정기결제와 확인할 지출을 찾아드려요")).toBeInTheDocument();
    const steps = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent("① 카드사에서 이용내역 받기");
    expect(steps[1]).toHaveTextContent("② 파일마다 카드 고르기");
    expect(steps[2]).toHaveTextContent("③ 올리기");
    expect(screen.getByText("청구서 말고 이용내역(승인내역)")).toHaveClass("font-semibold");
    expect(screen.getByText("같은 카드는 같은 이름으로 골라 주세요. 카드번호는 받지 않아요.")).toBeInTheDocument();
    expect(container.querySelector("#guide-hyundai")).toBeInTheDocument();
    expect(screen.getByText("다른 카드사 이용내역은 준비 중이에요")).toBeInTheDocument();
    expect(screen.getByText("분석을 위해 가맹점명과 집계 결과가 AI 서비스로 전송됩니다.")).toBeInTheDocument();
    expect(screen.getByText("원본 파일은 암호화해 보관하고, 거래는 이용일 기준 12개월 뒤 삭제됩니다.")).toBeInTheDocument();
    expect(container.querySelector("svg, canvas")).toBeNull();
    expect(container).not.toHaveTextContent("0원");
    expect(container).not.toHaveTextContent(/지금 바로|놓치지 마세요|!/);
  });
});
