import type { CategoryId } from "./category";
import type { CancelStyle, EventKind, IdentityScope } from "./parsing";
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
