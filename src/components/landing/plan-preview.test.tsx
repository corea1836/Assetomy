import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FINDING_KIND_LABELS } from "@/components/dashboard/finding-labels";
import { PlanPreview } from "@/components/landing/plan-preview";
import { buildDashboard } from "@/lib/analytics/dashboard";
import { DEMO_TODAY, DEMO_TRANSACTIONS } from "@/lib/demo/fixture";
import { formatWon } from "@/lib/format";

const dashboard = buildDashboard({
  transactions: DEMO_TRANSACTIONS, plan: "pro", today: DEMO_TODAY,
});
if (dashboard?.plan !== "pro") throw new Error("Expected a Pro demo dashboard");
const findings = dashboard.findings;
const candidateCount = Object.values(findings.byKind).reduce((sum, { count }) => sum + count, 0);
const candidateSentence = `확인이 필요한 지출 ${candidateCount}건 · 후보 합계 ${formatWon(findings.candidateTotal)}`;

describe("PlanPreview", () => {
  it("renders only the candidate count and total for Free, with no merchant or individual amounts", () => {
    const { container } = render(<PlanPreview plan="free" findings={findings} />);

    expect(screen.getByText("이 플랜에서 보이는 것")).toHaveClass("text-caption", "text-body");
    const sentence = screen.getByText(candidateSentence);
    expect(sentence.parentElement)
      .toHaveClass("rounded-2xl", "border", "border-amber-200", "bg-amber-50", "text-amber-900");
    expect(sentence.parentElement?.textContent).toBe(candidateSentence);
    expect(container.textContent).toBe(`이 플랜에서 보이는 것${candidateSentence}`);
    for (const item of findings.items) {
      expect(container.textContent).not.toContain(item.merchant);
      expect(screen.queryByText(formatWon(item.amount))).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("adds only the two largest findings in descending order for Pro without mutating the DTO", () => {
    const items = [...findings.items].sort((a, b) => a.amount - b.amount);
    const originalOrder = [...items];
    render(<PlanPreview plan="pro" findings={{ ...findings, items }} />);

    expect(screen.getByText("이 플랜에서 보이는 것"))
      .toHaveClass("text-caption", "text-muted-soft");
    expect(screen.getByText(candidateSentence).parentElement)
      .toHaveClass("rounded-2xl", "border", "border-hairline-dark", "bg-surface-dark-elevated", "text-amber-200");
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    [...items].sort((a, b) => b.amount - a.amount).slice(0, 2).forEach((item, index) => {
      expect(within(rows[index]).getByText(`${FINDING_KIND_LABELS[item.kind]} · ${item.merchant}`))
        .toBeInTheDocument();
      expect(within(rows[index]).getByText(formatWon(item.amount)))
        .toHaveClass("font-mono", "text-right");
    });
    expect(items).toEqual(originalOrder);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses the supplied kind counts and deduplicated candidate total for both plans", () => {
    const changed = {
      ...findings,
      byKind: {
        recurring: { count: 3, amount: 40_000 },
        duplicate: { count: 2, amount: 20_000 },
        large: { count: 1, amount: 10_000 },
      },
      candidateTotal: 67_890,
    };
    render(<><PlanPreview plan="free" findings={changed} /><PlanPreview plan="pro" findings={changed} /></>);

    expect(screen.getAllByText("확인이 필요한 지출 6건 · 후보 합계 67,890원"))
      .toHaveLength(2);
  });
});
