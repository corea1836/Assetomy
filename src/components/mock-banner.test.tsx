import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { MockBanner } from "./mock-banner";

it("renders the test mode notice", () => {
  render(<MockBanner />);

  expect(
    screen.getByText("테스트 모드: AI 분석과 결제는 모의로 동작합니다"),
  ).toBeInTheDocument();
});
