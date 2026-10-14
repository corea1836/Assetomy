import { MonthlySummary, MonthlySummaryStatus } from "@/components/dashboard/monthly-summary";
import { resolveMonthlySummary, type PreparedSummary, type SummaryDeps } from "@/lib/summary/monthly-summary";
import type { SummaryFeedback } from "@/types/summary";

export async function MonthlySummarySection({ userId, prepared, deps, feedback }: {
  userId: string;
  prepared: PreparedSummary;
  deps: SummaryDeps;
  feedback: SummaryFeedback;
}): Promise<React.JSX.Element> {
  const summary = await resolveMonthlySummary(userId, prepared, deps);

  if (summary.kind === "failed") {
    return <MonthlySummaryStatus state="failed" upgrade={prepared.plan === "free"} />;
  }

  return (
    <MonthlySummary
      summary={summary.summary}
      tips={summary.tips}
      tipCategories={summary.tipCategories}
      feedback={feedback}
      feedbackEnabled
      source="ai"
      upgrade={prepared.plan === "free"}
    />
  );
}
