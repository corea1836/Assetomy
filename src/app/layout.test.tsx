import { within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import RootLayout from "./layout";
import { getMode } from "@/lib/mode";

vi.mock("next/font/google", () => ({
  JetBrains_Mono: () => ({ variable: "jetbrains-mono" }),
}));

vi.mock("@/lib/mode", () => ({ getMode: vi.fn() }));

vi.mock("@vercel/analytics/next", () => ({
  Analytics: () => <div data-testid="analytics" />,
}));

describe("RootLayout", () => {
  it.each(["mock", "live"] as const)(
    "renders the mode notice only in mock mode (mode=%s)",
    (mode) => {
      vi.mocked(getMode).mockReturnValue(mode);

      const markup = renderToStaticMarkup(
        <RootLayout>
          <main>페이지 내용</main>
        </RootLayout>,
      );
      const page = new DOMParser().parseFromString(markup, "text/html");
      const banner = within(page.body).queryByText(
        "테스트 모드: AI 분석과 결제는 모의로 동작합니다",
      );

      expect(within(page.body).getByText("페이지 내용")).not.toBeNull();

      if (mode === "mock") {
        expect(banner).not.toBeNull();
        expect(page.body.firstElementChild).toBe(banner);
      } else {
        expect(banner).toBeNull();
      }
    },
  );

  it.each(["mock", "live"] as const)(
    "renders Analytics at the end of the body only in live mode (mode=%s)",
    (mode) => {
      vi.mocked(getMode).mockReturnValue(mode);

      const markup = renderToStaticMarkup(
        <RootLayout>
          <main>페이지 내용</main>
        </RootLayout>,
      );
      const page = new DOMParser().parseFromString(markup, "text/html");
      const analytics = within(page.body).queryByTestId("analytics");

      expect(within(page.body).getByText("페이지 내용")).not.toBeNull();
      if (mode === "live") {
        expect(analytics).not.toBeNull();
        expect(page.body.lastElementChild).toBe(analytics);
      } else {
        expect(analytics).toBeNull();
      }
    },
  );
});
