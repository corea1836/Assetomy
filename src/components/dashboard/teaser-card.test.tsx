import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FINDING_KIND_LABELS } from "./finding-labels";
import type { Teaser } from "@/types/dashboard";
import { TeaserCard } from "./teaser-card";

const teaser: Teaser = {
  byKind: { recurring: { count: 2, amount: 69_900 }, duplicate: { count: 1, amount: 64_000 }, large: { count: 1, amount: 920_000 } },
  candidateTotal: 1_053_900,
};
const empty: Teaser = {
  byKind: { recurring: { count: 0, amount: 0 }, duplicate: { count: 0, amount: 0 }, large: { count: 0, amount: 0 } }, candidateTotal: 0,
};
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockResolvedValue(Response.json({})); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("TeaserCard", () => {
  it("shows only kind counts and totals, with one exposure metric on mount", () => {
    const view = render(<TeaserCard teaser={teaser} dataMonthCount={4} />);
    expect(screen.getByRole("heading", { level: 2, name: "확인이 필요한 지출" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "탐지 종류별 요약" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      `${FINDING_KIND_LABELS.recurring}2건 · 69,900원`,
      `${FINDING_KIND_LABELS.duplicate}1건 · 64,000원`,
      `${FINDING_KIND_LABELS.large}1건 · 920,000원`,
    ]);
    expect(list.parentElement).toHaveClass("rounded-3xl", "border-amber-200", "bg-amber-50", "text-amber-900", "p-6", "sm:p-8");
    expect(screen.getByText(/후보 합계/)).toHaveTextContent("후보 합계 1,053,900원");
    expect(screen.getByText("같은 거래는 한 번만 셌어요. 정상 지출일 수 있어요. 상세에서 확인해 보세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pro로 보기" })).toHaveClass("bg-primary");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/metrics", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"event":"teaser_seen"}', keepalive: true,
    });
    view.rerender(<TeaserCard teaser={{ ...teaser }} dataMonthCount={4} />);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(view.container).not.toHaveTextContent(/예시 구름선 통신|예시 별숲 가구실|2026-09|9월 18일|절약|낭비|부정 결제|AI가 분석했어요/);
  });

  it("opens the common dialog with the current teaser and teaser source", () => {
    render(<TeaserCard teaser={teaser} dataMonthCount={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Pro로 보기" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("내 이용내역에서 확인이 필요한 지출 4건 · 후보 합계 1,053,900원");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/metrics", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"event":"upgrade_click","source":"teaser"}', keepalive: true,
    });
  });

  it("shows only the empty notice for zero candidates, without a button or metric", () => {
    render(<TeaserCard teaser={empty} dataMonthCount={2} />);
    expect(screen.getByText("이번 규칙으로 확인할 지출 후보가 발견되지 않았어요")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText(/후보 합계/)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([teaser, empty])("suggests adding another month for one-month data", (value) => {
    render(<TeaserCard teaser={value} dataMonthCount={1} />);
    expect(screen.getByText("한 달치만 더 올리면 정기결제를 찾아드려요")).toBeInTheDocument();
  });
});
