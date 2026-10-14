import { MonthlySummary, MonthlySummaryStatus } from "@/components/dashboard/monthly-summary";
import { resolveCardSummary, type CardSummaryDeps, type PreparedCardSummary } from "@/lib/summary/card-summary";
import type { SummaryFeedback } from "@/types/summary";

export async function CardSummarySection(props: {
  userId: string;
  prepared: PreparedCardSummary;
  deps: CardSummaryDeps;
  variant: "card-month" | "statement";
  feedback: SummaryFeedback;
}): Promise<React.JSX.Element> {
  const summary = await resolveCardSummary(props.userId, props.prepared, props.deps);

  if (summary.kind === "failed") {
    return <MonthlySummaryStatus state="failed" variant={props.variant} upgrade={props.prepared.plan === "free"} />;
  }

  return (
    <MonthlySummary
      summary={summary.summary}
      tips={summary.tips}
      tipCategories={summary.tipCategories}
      feedback={props.feedback}
      feedbackEnabled
      source="ai"
      variant={props.variant}
      upgrade={props.prepared.plan === "free"}
    />
  );
}
