import type { CategoryId } from "@/types/category";
import type { IsoDate, Transaction, YearMonth } from "@/types/transaction";

export const DEMO_TODAY: IsoDate = "2026-10-05";

const cards = {
  living: { cardId: "demo-living", cardLabel: "생활비 카드" },
  shopping: { cardId: "demo-shopping", cardLabel: "온라인 쇼핑 카드" },
} as const;

// 공개 데모에만 쓰는 가상의 가맹점이다.
const merchants = {
  music: { merchant: "예시 달무늬 음악", merchantKey: "demo-music", category: "subscription" },
  telecom: { merchant: "예시 구름선 통신", merchantKey: "demo-telecom", category: "housing" },
  cafe: { merchant: "예시 모래별 카페", merchantKey: "demo-cafe", category: "cafe" },
  food: { merchant: "예시 은잎 밥상", merchantKey: "demo-food", category: "food" },
  grocery: { merchant: "예시 바람결 장터", merchantKey: "demo-grocery", category: "grocery" },
  delivery: { merchant: "예시 달빛 도시락", merchantKey: "demo-delivery", category: "delivery" },
  transport: { merchant: "예시 별길 교통", merchantKey: "demo-transport", category: "transport" },
  shop: { merchant: "예시 종이달 상점", merchantKey: "demo-shop", category: "shopping" },
  health: { merchant: "예시 햇살잎 의원", merchantKey: "demo-health", category: "health" },
  culture: { merchant: "예시 구름책 극장", merchantKey: "demo-culture", category: "culture" },
  workshop: { merchant: "예시 둥근잎 공방", merchantKey: "demo-workshop", category: "culture" },
  furniture: { merchant: "예시 별숲 가구실", merchantKey: "demo-furniture", category: "shopping" },
} as const satisfies Record<string, {
  merchant: string;
  merchantKey: string;
  category: CategoryId;
}>;

type DemoRow = [
  day: string,
  card: keyof typeof cards,
  merchant: keyof typeof merchants,
  amount: number,
];

// 음악·통신은 매달 한 번, 일상 가맹점은 여러 번 방문한다.
const monthlyRows: DemoRow[] = [
  ["01", "shopping", "music", 14_900],
  ["02", "living", "food", 12_000],
  ["03", "living", "cafe", 4_500],
  ["04", "living", "transport", 4_200],
  ["05", "living", "telecom", 55_000],
  ["06", "living", "grocery", 62_000],
  ["08", "living", "delivery", 21_000],
  ["09", "living", "cafe", 5_500],
  ["10", "shopping", "shop", 69_000],
  ["11", "living", "food", 28_000],
  ["13", "living", "health", 18_000],
  ["14", "shopping", "culture", 16_000],
  ["16", "living", "transport", 5_100],
  ["17", "living", "cafe", 5_000],
  ["20", "living", "food", 35_000],
  ["22", "living", "grocery", 88_000],
  ["24", "living", "delivery", 24_000],
  ["25", "living", "health", 23_000],
  ["26", "shopping", "shop", 48_000],
  ["27", "living", "food", 18_000],
  ["28", "shopping", "culture", 19_000],
  ["30", "living", "cafe", 6_000],
];

const septemberRows: DemoRow[] = [
  ["18", "shopping", "workshop", 32_000],
  ["18", "shopping", "workshop", 32_000],
  ["23", "shopping", "furniture", 920_000],
  ["29", "shopping", "shop", -48_000],
];

function transactionsForMonth(month: YearMonth, rows: DemoRow[]): Transaction[] {
  return rows.map(([day, card, merchant, amount], index) => ({
    id: `demo-${month}-${index + 1}`,
    date: `${month}-${day}`,
    ...cards[card],
    ...merchants[merchant],
    amount,
  }));
}

export const DEMO_TRANSACTIONS: Transaction[] = [
  "2026-06", "2026-07", "2026-08", "2026-09",
].flatMap((month) => transactionsForMonth(
  month,
  month === "2026-09" ? [...monthlyRows, ...septemberRows] : monthlyRows,
));

export const DEMO_SUMMARY: string =
  "이번 달에는 가구 구매가 더해져 지난달보다 지출이 늘었어요. "
  + "음악 구독과 통신 요금은 정기결제로 보이고, 공방에서 같은 날 같은 금액이 반복된 결제도 확인이 필요해요. "
  + "후보 지출은 정상 지출일 수 있으니 실제 이용내역과 함께 확인해 주세요.";
