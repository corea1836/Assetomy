import type { LoginErrorCode } from "@/types/auth";
import type { ApiErrorCode } from "@/types/upload";

export const SUMMARY_STATUS_MESSAGES = {
  pending: "이번 달 요약을 만들고 있어요",
  statementPending: "이번 명세서 요약을 만들고 있어요",
  failed: "요약을 만들지 못했어요. 새로고침하면 다시 만들어요.",
} as const;

export function cardEditErrorMessage(code: string): string {
  switch (code) {
    case "INVALID_LABEL": return "카드 이름은 1~30자로 입력해 주세요.";
    case "DUPLICATE_LABEL": return "같은 이름의 카드가 있어요. 다른 이름을 입력해 주세요.";
    case "INVALID_CARD": return "분석 기준을 확인해 주세요. 이용 기간은 매달 1~31일 중 시작일을 입력해요.";
    case "NOT_FOUND": return "카드를 찾을 수 없어요. 새로고침해 주세요.";
    default: return "잠시 후 다시 시도해 주세요.";
  }
}

export const LOGIN_ERROR_MESSAGES: Record<LoginErrorCode, string> = {
  cancelled: "구글 로그인을 취소했어요. 계속하려면 다시 시도해 주세요.",
  failed: "로그인을 마치지 못했어요. 잠시 후 다시 시도해 주세요.",
};

export function parseLoginErrorCode(value: unknown): LoginErrorCode | null {
  return value === "cancelled" || value === "failed" ? value : null;
}

const UPLOAD_ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  FILE_TOO_LARGE: "파일이 4MB를 넘어요. 기간을 나눠서 받아 주세요.",
  UNSUPPORTED_FILE: '현대카드 명세서의 "이용 내역" 화면을 PDF로 저장한 파일인지 확인해 주세요.',
  UNREADABLE: "파일의 줄 배치를 읽지 못했어요. 이용 내역을 최근순으로 두고 다시 저장해 주세요.",
  CARD_NOT_FOUND: "카드를 찾을 수 없어요. 카드를 다시 골라 주세요.",
  CARD_SCOPE_MISMATCH: "이 카드에 올렸던 파일과 형식이 달라요. 다른 카드를 골라 주세요.",
  CARD_MISMATCH: "이 카드에 올릴 수 없는 파일이에요. 다른 카드를 골라 주세요.",
  RATE_LIMITED: "최근 24시간 동안 올릴 수 있는 30개를 모두 썼어요. 시간이 지난 뒤 다시 올려 주세요.",
  BUSY: "다른 파일을 처리하고 있어요. 잠시 후 다시 시도해 주세요.",
  TEMPORARY_FAILURE: "처리를 마치지 못했어요. 잠시 후 다시 시도해 주세요.",
  UNAUTHORIZED: "로그인이 만료됐어요. 다시 로그인해 주세요.",
  INVALID_LABEL: "카드 이름은 1~30자로 입력해 주세요.",
  DUPLICATE_LABEL: "같은 이름의 카드가 있어요. 목록에서 골라 주세요.",
  INVALID_CARD: "카드사와 분석 기준을 확인해 주세요. 이용 기간은 매달 1~31일 중 시작일을 입력해요.",
  UPLOAD_PROCESSING: "아직 처리 중이에요. 잠시 후 다시 시도해 주세요.",
  BAD_REQUEST: "요청을 처리하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.",
  FORBIDDEN: "요청을 처리하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.",
  NOT_FOUND: "요청을 처리하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.",
};

const UNSUPPORTED_REASONS: Record<string, string> = {
  not_pdf: "지금은 현대카드 이용 내역 PDF만 읽을 수 있어요.",
  empty_file: "빈 파일이에요. 이용내역을 다시 받아 주세요.",
  encrypted: "암호가 걸린 PDF는 읽을 수 없어요. 암호 없이 다시 저장해 주세요.",
  too_many_pages: "100쪽이 넘는 PDF는 읽을 수 없어요. 기간을 나눠서 받아 주세요.",
  no_text: "글자를 읽을 수 없는 PDF예요. 앱이나 웹에서 PDF로 저장한 파일을 올려 주세요.",
};

const UNREADABLE_REASONS: Record<string, string> = {
  total_mismatch: "명세서 금액과 거래 합계가 맞지 않아 저장하지 않았어요.",
  not_lump_sum: "할부처럼 일시불이 아닌 거래가 있어 저장하지 않았어요. 지금은 일시불 거래만 읽을 수 있어요.",
  cancel_label: "취소 표시가 있는 거래가 있어 저장하지 않았어요.",
  multiple_cards: "여러 카드의 거래가 섞여 있어요. 카드별로 다시 받아 주세요.",
  no_transactions: "저장할 거래가 없는 파일이에요.",
  too_many_rows: "거래가 5,000건을 넘어요. 기간을 나눠서 받아 주세요.",
};

const CARD_MISMATCH_REASONS: Record<string, string> = {
  issuer: "등록한 카드사와 파일의 카드사가 달라요. 맞는 카드를 고르거나 새 카드를 추가해 주세요.",
  product: "이 카드에 처음 올린 명세서와 카드 상품이 달라요. 맞는 카드를 고르거나 새 카드를 추가해 주세요.",
};

export function uploadErrorMessage(code: ApiErrorCode, reason?: string): string {
  if (code === "CARD_MISMATCH" && reason && Object.hasOwn(CARD_MISMATCH_REASONS, reason)) {
    return CARD_MISMATCH_REASONS[reason];
  }
  const reasons = code === "UNSUPPORTED_FILE" ? UNSUPPORTED_REASONS
    : code === "UNREADABLE" ? UNREADABLE_REASONS : null;
  if (reason && reasons && Object.hasOwn(reasons, reason)) return reasons[reason];
  return UPLOAD_ERROR_MESSAGES[code];
}

export function billingErrorMessage(code: ApiErrorCode): string {
  if (code === "TEMPORARY_FAILURE") return "결제 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요.";
  if (code === "NOT_FOUND") return "구독 정보를 찾지 못했어요. 새로고침한 뒤 다시 시도해 주세요.";
  if (code === "UNAUTHORIZED") return UPLOAD_ERROR_MESSAGES.UNAUTHORIZED;
  return UPLOAD_ERROR_MESSAGES.BAD_REQUEST;
}

export function categoryErrorMessage(code: ApiErrorCode): string {
  if (code === "NOT_FOUND") return "이 가맹점의 거래를 찾지 못했어요. 새로고침한 뒤 다시 시도해 주세요.";
  if (code === "UNAUTHORIZED") return UPLOAD_ERROR_MESSAGES.UNAUTHORIZED;
  return "카테고리를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.";
}
