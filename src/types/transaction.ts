import type { CategoryId } from "./category";

export type IsoDate = string; // 'YYYY-MM-DD'
export type YearMonth = string; // 'YYYY-MM'

export type Transaction = {
  id: string;
  cardId: string;
  cardLabel: string; // 사용자가 붙인 카드 이름
  date: IsoDate; // 이용일
  merchant: string; // 표시용 가맹점명
  merchantKey: string; // 정규화 가맹점명. 그룹핑·카테고리 수정의 단위
  amount: number; // 원 단위 안전한 정수. 지출 양수, 취소·환불 음수
  category: CategoryId;
};
