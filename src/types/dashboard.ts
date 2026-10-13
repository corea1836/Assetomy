import type { CategoryId } from "./category";
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

export type Snapshot = {
  month: YearMonth;
  period: Period; // 그 달 거래의 첫·마지막 이용일(반영 기간)
  total: number; // 그 달 거래 금액 합(취소·환불 포함)
  transactionCount: number;
  inProgress: boolean; // 진행 중인 달
  categories: CategoryAmount[];
  topMerchants: MerchantAmount[];
  otherMerchants: MerchantAmount[]; // 그 달의 topMerchants 밖 가맹점, 금액순
  daily: DailyAmount[]; // 그 달 1일~말일, 거래 없는 날은 0
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
