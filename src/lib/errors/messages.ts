import type { LoginErrorCode } from "@/types/auth";

export const LOGIN_ERROR_MESSAGES: Record<LoginErrorCode, string> = {
  cancelled: "구글 로그인을 취소했어요. 계속하려면 다시 시도해 주세요.",
  failed: "로그인을 마치지 못했어요. 잠시 후 다시 시도해 주세요.",
};

export function parseLoginErrorCode(value: unknown): LoginErrorCode | null {
  return value === "cancelled" || value === "failed" ? value : null;
}
