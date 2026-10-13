import { MonthlySummary, MonthlySummaryStatus } from "@/components/dashboard/monthly-summary";
import { resolveMonthlySummary, type PreparedSummary, type SummaryDeps } from "@/lib/summary/monthly-summary";

export async function MonthlySummarySection({ userId, prepared, deps }: {
  userId: string;
  prepared: PreparedSummary;
  deps: SummaryDeps;
}): Promise<React.JSX.Element> {
  const summary = await resolveMonthlySummary(userId, prepared, deps);

  if (summary.kind === "failed") {
    return <MonthlySummaryStatus state="failed" upgrade={prepared.plan === "free"} />;
  }

  return <MonthlySummary summary={summary.summary} tips={summary.tips} source="ai" upgrade={prepared.plan === "free"} />;
}
