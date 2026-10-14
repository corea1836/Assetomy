import Link from "next/link";
import { buttonClass } from "@/components/button-styles";
import { formatCardBasis, formatMonth, formatPeriod, formatStatementOption } from "@/lib/format";
import type { CardDashboard } from "@/types/dashboard";
import type { CardOption } from "@/types/upload";
import type { YearMonth } from "@/types/transaction";
import { CardEditButton } from "./card-edit-dialog";
import { PeriodSelect } from "./period-select";

export function CardHeading(props: { card: CardOption; dashboard: CardDashboard | null }): React.JSX.Element {
  const dashboard = props.dashboard;
  return (
    <header>
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-title-lg text-ink">{props.card.label}</h1>
        {dashboard?.basis === "month" && (
          <>
            <PeriodSelect
              cardId={props.card.id}
              param="month"
              value={dashboard.month}
              options={dashboard.months.map(({ month }) => ({ value: month, label: formatMonth(month) }))}
              ariaLabel="월 선택"
            />
            <p className="text-caption tabular-nums text-body">
              {formatMonth(dashboard.lastDate.slice(0, 7) as YearMonth)}까지 반영됨
            </p>
          </>
        )}
        {dashboard?.basis === "cycle" && (
          <>
            <PeriodSelect
              cardId={props.card.id}
              param="statement"
              value={dashboard.statementDate}
              options={dashboard.statements.map(({ statementDate }) => ({
                value: statementDate,
                label: formatStatementOption(statementDate),
              }))}
              ariaLabel="명세서 선택"
            />
            <p className="text-caption tabular-nums text-body">이용 기간 {formatPeriod(dashboard.cyclePeriod)}</p>
          </>
        )}
        <Link href="#upload" className={buttonClass("secondary", "sm")}>새 이용내역 추가</Link>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p className="text-sm text-body">{formatCardBasis(props.card)}</p>
        <CardEditButton card={props.card} />
      </div>
    </header>
  );
}
