import type { CategoryId } from "./category";
import type { AnalysisBasis, CardIssuer } from "./card";
import type { CancelStyle, EventKind, IdentityScope, UnreadableReason, UnsupportedFileReason } from "./parsing";
import type { IsoDate } from "./transaction";

export type UploadStatus = "processing" | "done" | "no_new" | "failed";

export type CreateCardResult =
  | { kind: "created"; cardId: string }
  | { kind: "duplicate_label" }
  | { kind: "invalid_label" };

export type BeginUploadInput = {
  userId: string;
  cardId: string;
  fileName: string;
  fileHash: string;
  fileSize: number;
};

export type BeginUploadResult =
  | { kind: "started"; uploadId: string; leaseExpiresAt: string }
  | { kind: "duplicate"; existingCardId: string }
  | { kind: "card_not_found" }
  | { kind: "rate_limited" }
  | { kind: "busy" };

export type IngestRow = {
  usedOn: IsoDate;
  merchant: string;
  merchantKey: string;
  amount: number;
  eventKind: EventKind;
  category: CategoryId;
  fingerprint: string;
};

export type IngestUploadInput = {
  userId: string;
  uploadId: string;
  identityScope: IdentityScope;
  cancelStyle: CancelStyle;
  rows: IngestRow[];
  skipped: number;
};

export type UploadSummary = {
  inserted: number;
  duplicates: number;
  skipped: number;
  periodFrom: IsoDate | null;
  periodTo: IsoDate | null;
  netAmount: number;
};

export type CardOption = {
  id: string;
  label: string;
  issuer: CardIssuer;
  analysisBasis: AnalysisBasis;
  cycleStartDay: number | null;
};

export type ApiErrorCode =
  | "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND"
  | "INVALID_LABEL" | "DUPLICATE_LABEL" | "INVALID_CARD"
  | "CARD_NOT_FOUND" | "CARD_SCOPE_MISMATCH" | "UPLOAD_PROCESSING"
  | "FILE_TOO_LARGE" | "UNSUPPORTED_FILE" | "UNREADABLE"
  | "RATE_LIMITED" | "BUSY" | "TEMPORARY_FAILURE";

export type ApiErrorBody = { error: { code: ApiErrorCode; reason?: string } };
export type UploadResultDto =
  | ({ kind: "done" | "no_new"; uploadId: string } & UploadSummary)
  | { kind: "duplicate"; existingCardLabel: string | null };
export type CreateCardResponse = { card: CardOption };
export type UploadResponse = { result: UploadResultDto };

export type DoneUpload = {
  id: string; cardId: string; fileName: string; inserted: number; periodFrom: IsoDate; periodTo: IsoDate;
};
export type UploadHistoryItem = Omit<DoneUpload, "cardId"> & { cardLabel: string | null };
export type UploadOutcomeRecord =
  | ({ status: "done" | "no_new" } & UploadSummary)
  | { status: "processing" | "failed" };

export type ProcessUploadInput = {
  userId: string;
  cardId: string;
  fileName: string;
  bytes: Uint8Array;
};

export type ProcessUploadOutcome =
  | ({ kind: "done" | "no_new"; uploadId: string } & UploadSummary)
  | { kind: "duplicate"; existingCardId: string }
  | { kind: "rejected"; uploadId: string; code: "UNSUPPORTED_FILE"; reason: UnsupportedFileReason }
  | { kind: "rejected"; uploadId: string; code: "UNREADABLE"; reason: UnreadableReason }
  | { kind: "card_not_found" }
  | { kind: "rate_limited" }
  | { kind: "busy" }
  | { kind: "card_scope_mismatch"; uploadId: string }
  | { kind: "temporary_failure"; uploadId: string | null };

export type IngestUploadResult =
  | ({ kind: "done" | "no_new" } & UploadSummary)
  | { kind: "duplicate"; existingCardId: string }
  | { kind: "not_found" }
  | { kind: "not_processing"; status: UploadStatus }
  | { kind: "lease_expired" }
  | { kind: "card_scope_mismatch" };

export type FailUploadResult =
  | { kind: "failed" }
  | { kind: "not_found" }
  | { kind: "not_processing"; status: UploadStatus };

export type DeleteUploadResult =
  | { kind: "deleted" }
  | { kind: "not_found" }
  | { kind: "processing" };
