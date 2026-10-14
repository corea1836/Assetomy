import type { IsoDate } from "./transaction";
import type { CardIssuer } from "./card";

// PDF에서 뽑은 글자 조각. page는 1부터, x·y는 PDF 좌표(y는 위로 갈수록 크다).
export type PdfTextItem = { page: number; x: number; y: number; str: string };
export type PdfCell = { x: number; str: string };
export type PdfRow = { page: number; y: number; cells: PdfCell[]; text: string };

export type EventKind = "purchase" | "cancel";
export type IdentityScope = "content"; // 승인번호 범위는 표 형식 프로필에서 추가한다.
export type CancelStyle = "negative_amount";
export type StatementProfile = "hyundai_statement_pdf";
export type StatementInfo = {
  date: IsoDate;
  productName: string;
  savedAt: string | null;
};

export type ParsedTransaction = {
  date: IsoDate;
  merchant: string; // 표시용 가맹점명
  merchantKey: string; // normalizeMerchantKey(merchant)
  amount: number; // 원 단위 안전한 정수. 지출 양수, 취소·환불 음수
  eventKind: EventKind; // amount < 0 이면 'cancel'
  sourceEventKey: string; // 식별 범위 안의 거래 키(ADR-006)
};

export type ParseSuccess = {
  ok: true;
  profile: StatementProfile;
  issuer: CardIssuer;
  identityScope: IdentityScope;
  cancelStyle: CancelStyle;
  statementTotal: number;
  statement: StatementInfo;
  transactions: ParsedTransaction[];
};

export type UnsupportedFileReason =
  | "not_pdf"
  | "encrypted"
  | "too_many_pages"
  | "no_text"
  | "unknown_format";

export type UnreadableReason =
  | "total_mismatch"
  | "not_lump_sum"
  | "cancel_label"
  | "multiple_cards"
  | "broken_layout"
  | "no_transactions"
  | "too_many_rows";

export type ParseFailure =
  | { ok: false; code: "UNSUPPORTED_FILE"; reason: UnsupportedFileReason }
  | { ok: false; code: "UNREADABLE"; reason: UnreadableReason };

export type ParseResult = ParseSuccess | ParseFailure;
