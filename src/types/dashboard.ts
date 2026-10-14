import type { CategoryId } from "./category";
import type { CardOption } from "./upload";
import type { IsoDate, YearMonth } from "./transaction";

export type Plan = "free" | "pro";
export type Period = { from: IsoDate; to: IsoDate };
export type MonthOption = { month: YearMonth; period: Period };

export type CategoryAmount = {
  category: CategoryId;
  amount: number;
  ratio: number | null;
};
export type MerchantAmount = {
  merchantKey: string;
  merchant: string;
  category: CategoryId;
  amount: number;
  count: number;
};
export type DailyAmount = { date: IsoDate; amount: number };

export type PeriodSnapshot = {
  period: Period; // 선택한 거래의 첫·마지막 이용일(반영 기간)
  total: number; // 선택한 거래의 금액 합(취소·환불 포함)
  transactionCount: number;
  categories: CategoryAmount[];
  topMerchants: MerchantAmount[];
  otherMerchants: MerchantAmount[]; // topMerchants 밖 가맹점, 금액순
  daily: DailyAmount[]; // 요청한 기간의 날마다, 거래 없는 날은 0
};
export type Snapshot = PeriodSnapshot & {
  month: YearMonth;
  inProgress: boolean; // 진행 중인 달
};

export type MonthOverMonth = {
  previousMonth: YearMonth;
  previousTotal: number;
  diff: number;
};

export type FindingKind = "recurring" | "duplicate" | "large";
export type KindSummary = { count: number; amount: number };
export type FindingSummary = {
  byKind: Record<FindingKind, KindSummary>;
  candidateTotal: number;
};
export type Teaser = FindingSummary;

export type FindingTransaction = {
  id: string;
  date: IsoDate;
  amount: number;
  cardLabel: string;
};
type FindingBase = {
  merchantKey: string;
  merchant: string;
  category: CategoryId;
  amount: number; // transactions의 amount 합
  transactions: FindingTransaction[];
};
export type Finding =
  | (FindingBase & { kind: "recurring"; seriesMonths: YearMonth[] })
  | (FindingBase & { kind: "duplicate" | "large" });
export type Findings = FindingSummary & { items: Finding[] };

export type TrendMonth = {
  month: YearMonth;
  total: number;
  inProgress: boolean;
};
export type CategoryChange = {
  category: CategoryId;
  current: number;
  previous: number;
  diff: number;
};
export type Trend = {
  months: TrendMonth[];
  categoryChanges: CategoryChange[] | null;
};

type DashboardBase = {
  month: YearMonth; // 선택된 달
  months: MonthOption[]; // 거래가 있는 달, 최신순
  lastDate: IsoDate; // 전체 거래의 마지막 이용일
  snapshot: Snapshot;
  mom: MonthOverMonth | null;
  partialMonth: YearMonth | null; // 카드 내역이 일부만 있어 전월 비교를 건너뛴 달
};
export type FreeDashboard = DashboardBase & {
  plan: "free";
  teaser: Teaser;
  trendAvailable: boolean;
};
export type ProDashboard = DashboardBase & {
  plan: "pro";
  findings: Findings;
  trend: Trend | null;
};
export type Dashboard = FreeDashboard | ProDashboard;

export type CardStatementOption = { statementDate: IsoDate; cyclePeriod: Period };
export type StatementComparison = {
  previousStatementDate: IsoDate;
  previousTotal: number;
  diff: number;
};

export type CardMonthView = {
  basis: "month";
  month: YearMonth;
  months: MonthOption[];
  lastDate: IsoDate;
  snapshot: Snapshot;
  mom: MonthOverMonth | null;
  partialMonth: YearMonth | null;
};
export type CardStatementView = {
  basis: "cycle";
  statementDate: IsoDate;
  statements: CardStatementOption[];
  cyclePeriod: Period;
  complete: boolean;
  snapshot: PeriodSnapshot;
  comparison: StatementComparison | null;
  comparisonSkipped: boolean;
};
type CardDashboardBase = { card: CardOption } & (CardMonthView | CardStatementView);
export type FreeCardDashboard = CardDashboardBase & { plan: "free" };
export type ProCardDashboard = CardDashboardBase & {
  plan: "pro";
  categoryChanges: CategoryChange[] | null;
};
export type CardDashboard = FreeCardDashboard | ProCardDashboard;
