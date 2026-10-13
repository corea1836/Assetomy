"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { buttonClass } from "@/components/button-styles";
import { uploadErrorMessage } from "@/lib/errors/messages";
import { formatPeriod, formatWon } from "@/lib/format";
import type { ApiErrorBody, CardOption, UploadResultDto } from "@/types/upload";
import { DataNotice } from "./data-notice";
import { sendUpload } from "./send-upload";

const MAX_FILE_BYTES = 4_194_304;
const NEW_CARD = "__new_card__";
type UploadError = ApiErrorBody["error"];
const TEMPORARY_ERROR: UploadError = { code: "TEMPORARY_FAILURE" };
const errorSchema = z.object({ error: z.object({
  code: z.enum([
    "BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "INVALID_LABEL", "DUPLICATE_LABEL",
    "CARD_NOT_FOUND", "CARD_SCOPE_MISMATCH", "UPLOAD_PROCESSING", "FILE_TOO_LARGE",
    "UNSUPPORTED_FILE", "UNREADABLE", "RATE_LIMITED", "BUSY", "TEMPORARY_FAILURE",
  ]),
  reason: z.string().optional(),
}) });
const cardSchema = z.object({ card: z.object({ id: z.string().min(1), label: z.string().min(1).max(30) }) });
const uploadSchema = z.object({ result: z.union([
  z.object({
    kind: z.enum(["done", "no_new"]), uploadId: z.string().min(1),
    inserted: z.int().nonnegative(), duplicates: z.int().nonnegative(), skipped: z.int().nonnegative(),
    periodFrom: z.iso.date().nullable(), periodTo: z.iso.date().nullable(), netAmount: z.int(),
  }).refine((result) => result.kind !== "done" || (
    result.inserted > 0 && result.periodFrom !== null && result.periodTo !== null && result.periodFrom <= result.periodTo
  )),
  z.object({ kind: z.literal("duplicate"), existingCardLabel: z.string().nullable() }),
]) });

function responseError(body: unknown): UploadError {
  const parsed = errorSchema.safeParse(body);
  return parsed.success ? parsed.data.error : TEMPORARY_ERROR;
}

async function fetchJson(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(url, init);
    return { status: response.status, body: await response.json() as unknown };
  } catch {
    return { status: 0, body: null };
  }
}

type Row = {
  id: number;
  file: File;
  cardId: string;
  label: string;
  addingCard: boolean;
  cardError?: UploadError;
  status: "waiting" | "uploading" | "analyzing" | "complete" | "failed" | "deleted";
  error?: UploadError;
  result?: UploadResultDto;
};

const STATUS_LABELS: Record<Row["status"], string> = {
  waiting: "대기", uploading: "올리는 중", analyzing: "분석 중", complete: "완료", failed: "실패", deleted: "삭제했어요",
};

function resultLine(result: UploadResultDto): string {
  if (result.kind === "duplicate") return "이미 올린 내역이에요";
  if (result.kind === "no_new") {
    return `이미 올린 내역이에요${result.skipped ? ` · 12개월이 지난 거래 ${result.skipped}건 제외` : ""}`;
  }
  const period = result.periodFrom && result.periodTo
    ? ` · ${formatPeriod({ from: result.periodFrom, to: result.periodTo })}` : "";
  return `${result.inserted}건${period} · 지출 ${formatWon(result.netAmount)}`
    + (result.duplicates ? ` · 중복 ${result.duplicates}건` : "")
    + (result.skipped ? ` · 제외 ${result.skipped}건` : "");
}

function openGuide() {
  const details = document.getElementById("guide-hyundai");
  if (!(details instanceof HTMLDetailsElement)) return;
  details.open = true;
  const summary = details.querySelector("summary");
  summary?.focus();
  summary?.scrollIntoView?.({ block: "center" });
}

function DeleteDialog({ row, opener, onClose, onDeleted }: {
  row: Row & { result: UploadResultDto & { kind: "done" } };
  opener: HTMLButtonElement;
  onClose: () => void;
  onDeleted: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const deleting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UploadError | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      opener.focus();
    };
  }, [opener]);

  async function remove() {
    if (deleting.current) return;
    deleting.current = true;
    setBusy(true);
    setError(null);
    const reply = await fetchJson(`/api/uploads/${encodeURIComponent(row.result.uploadId)}`, { method: "DELETE" });
    const parsed = z.object({ deleted: z.literal(true) }).safeParse(reply.body);
    if (reply.status === 200 && parsed.success) onDeleted();
    else setError(responseError(reply.body));
    deleting.current = false;
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-surface-dark/40 p-4">
      <div
        ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
        aria-busy={busy} tabIndex={-1}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-3xl bg-canvas p-6 focus-visible:outline-2 focus-visible:outline-primary sm:p-8"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (!deleting.current) onClose();
          }
          if (event.key !== "Tab") return;
          const buttons = panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
          if (!buttons?.length) { event.preventDefault(); return; }
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {
            event.preventDefault(); first.focus();
          }
        }}
      >
        <h2 id={titleId} className="text-lg font-semibold text-ink">이 업로드를 삭제할까요?</h2>
        <p id={descriptionId} className="mt-3 text-base tabular-nums text-body">
          이 파일로 처음 저장된 거래 {row.result.inserted}건을 지워요. 다른 파일과 겹쳐서 제외됐던 거래는 되살아나지 않으니, 필요하면 그 파일을 다시 올려 주세요.
        </p>
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-danger">{uploadErrorMessage(error.code, error.reason)}</p>}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={busy} onClick={() => void remove()} className={`${buttonClass("secondary").replace("text-ink", "text-danger")} sm:order-2`}>
            {busy ? "삭제 중…" : "삭제"}
          </button>
          <button type="button" disabled={busy} onClick={onClose} className={buttonClass("secondary")}>취소</button>
        </div>
      </div>
    </div>
  );
}

export function UploadPanel({ cards }: { cards: CardOption[] }): React.JSX.Element {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const nextRowId = useRef(0);
  const processing = useRef(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [createdCards, setCreatedCards] = useState<CardOption[]>([]);
  const [running, setRunning] = useState(false);
  const [hasGuide, setHasGuide] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [deletion, setDeletion] = useState<{ row: Row & { result: UploadResultDto & { kind: "done" } }; opener: HTMLButtonElement } | null>(null);
  const options = [...cards, ...createdCards.filter((card) => !cards.some((existing) => existing.id === card.id))];
  const waiting = rows.filter((row) => row.status === "waiting");
  const missingCards = waiting.filter((row) => !options.some((card) => card.id === row.cardId)).length;
  const canUpload = !running && waiting.length > 0 && missingCards === 0 && !rows.some((row) => row.addingCard);
  const fileLabel = rows.length ? "파일 추가" : "파일 선택";

  function updateRow(id: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function selectFiles(files: FileList | null) {
    if (!files || processing.current) return;
    setHasGuide(document.getElementById("guide-hyundai") instanceof HTMLDetailsElement);
    const added = Array.from(files, (file): Row => {
      const error: UploadError | undefined = !file.name.toLowerCase().endsWith(".pdf")
        ? { code: "UNSUPPORTED_FILE", reason: "not_pdf" }
        : file.size > MAX_FILE_BYTES ? { code: "FILE_TOO_LARGE" } : undefined;
      return { id: nextRowId.current++, file, cardId: "", label: "", addingCard: false, status: error ? "failed" : "waiting", error };
    });
    setRows((current) => [...current, ...added]);
    setAnnouncement(added.map((row) => `${row.file.name} ${STATUS_LABELS[row.status]}`).join(" · "));
  }

  async function addCard(row: Row) {
    if (row.addingCard || processing.current) return;
    const label = row.label.trim();
    if (!label || label.length > 30) {
      updateRow(row.id, { cardError: { code: "INVALID_LABEL" } });
      return;
    }
    updateRow(row.id, { addingCard: true, cardError: undefined });
    const reply = await fetchJson("/api/cards", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }),
    });
    const parsed = cardSchema.safeParse(reply.body);
    if (reply.status === 201 && parsed.success) {
      const card = parsed.data.card;
      setCreatedCards((current) => [...current.filter((existing) => existing.id !== card.id), card]);
      updateRow(row.id, { cardId: card.id, addingCard: false, cardError: undefined });
      setAnnouncement(`${row.file.name} 카드 추가 완료`);
    } else {
      updateRow(row.id, { addingCard: false, cardError: responseError(reply.body) });
      setAnnouncement(`${row.file.name} 카드 추가 실패`);
    }
  }

  async function startUploads() {
    if (processing.current || !canUpload) return;
    processing.current = true;
    setRunning(true);
    let cursor = 0;
    let hadDone = false;
    async function worker() {
      while (cursor < waiting.length) {
        const row = waiting[cursor++];
        updateRow(row.id, { status: "uploading", error: undefined });
        setAnnouncement(`${row.file.name} 올리는 중`);
        const form = new FormData();
        form.set("cardId", row.cardId);
        form.set("file", row.file);
        try {
          const reply = await sendUpload(form, () => {
            setRows((current) => current.map((entry) => entry.id === row.id && entry.status === "uploading" ? { ...entry, status: "analyzing" } : entry));
            setAnnouncement(`${row.file.name} 분석 중`);
          });
          const parsed = uploadSchema.safeParse(reply.body);
          if (reply.status === 200 && parsed.success) {
            hadDone ||= parsed.data.result.kind === "done";
            updateRow(row.id, { status: "complete", result: parsed.data.result });
            setAnnouncement(`${row.file.name} 완료`);
          } else {
            updateRow(row.id, { status: "failed", error: responseError(reply.body) });
            setAnnouncement(`${row.file.name} 실패`);
          }
        } catch {
          updateRow(row.id, { status: "failed", error: TEMPORARY_ERROR });
          setAnnouncement(`${row.file.name} 실패`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, waiting.length) }, worker));
    processing.current = false;
    setRunning(false);
    if (hadDone) router.refresh();
  }

  function resetRow(row: Row, clearCard: boolean) {
    updateRow(row.id, { status: "waiting", cardId: clearCard ? "" : row.cardId, error: undefined, result: undefined, cardError: undefined });
    setAnnouncement(`${row.file.name} 대기`);
  }

  function errorAction(row: Row): React.ReactNode {
    const code = row.error?.code;
    if (code === "TEMPORARY_FAILURE" || code === "BUSY") {
      return <button type="button" disabled={running} className={buttonClass("secondary", "sm")} onClick={() => resetRow(row, false)}>다시 시도</button>;
    }
    if (code === "CARD_NOT_FOUND" || code === "CARD_SCOPE_MISMATCH") {
      return <button type="button" disabled={running} className={buttonClass("secondary", "sm")} onClick={() => resetRow(row, true)}>카드 다시 고르기</button>;
    }
    if (hasGuide && (code === "FILE_TOO_LARGE" || code === "UNSUPPORTED_FILE" || code === "UNREADABLE")) {
      return <button type="button" className={buttonClass("secondary", "sm")} onClick={openGuide}>가이드 열기</button>;
    }
    if (code === "UNAUTHORIZED") {
      return <a href="/login?next=%2Fdashboard" className={buttonClass("secondary", "sm")}>다시 로그인</a>;
    }
    return null;
  }

  return (
    <>
      <div inert={deletion !== null} className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={inputId} className="sr-only">{fileLabel}</label>
          <input
            ref={inputRef} id={inputId} type="file" multiple accept=".pdf,application/pdf" className="sr-only" tabIndex={-1} disabled={running}
            onChange={(event) => { selectFiles(event.target.files); event.target.value = ""; }}
          />
          <button type="button" disabled={running} onClick={() => inputRef.current?.click()} className={buttonClass(rows.length ? "secondary" : "primary")}>{fileLabel}</button>
          {rows.length > 0 && <button type="button" disabled={!canUpload} onClick={() => void startUploads()} className={buttonClass("primary")}>올리기</button>}
        </div>
        <div className="mt-3 space-y-1 text-caption text-body">
          <p>원본 파일은 암호화해 보관해요</p>
          <p>파일당 4MB · 최근 24시간 30개 · 동시에 2개씩 처리해요</p>
          <p>여러 카드가 섞인 파일은 카드별로 다시 받아 주세요</p>
          <p>기간이 겹쳐도 같은 거래는 한 번만 반영돼요</p>
        </div>
        <div className="mt-3"><DataNotice /></div>
        {missingCards > 0 && <p className="mt-3 text-caption tabular-nums text-body">카드를 고르지 않은 파일이 {missingCards}개 있어요</p>}
        {rows.length > 0 && (
          <ul aria-label="업로드 파일" className="mt-6 min-w-0">
            {rows.map((row) => {
              const cardLabel = options.find((card) => card.id === row.cardId)?.label;
              const statusColor = row.status === "failed" ? "text-danger" : row.status === "complete" ? "text-primary" : "text-body";
              return (
                <li key={row.id} className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-hairline-soft px-2 py-3">
                  <span className="min-w-0 basis-full truncate text-sm text-ink sm:flex-1 sm:basis-0" title={row.file.name}>{row.file.name}</span>
                  {row.status === "waiting" ? (
                    <select
                      aria-label="카드" value={row.cardId} disabled={running || row.addingCard}
                      className="h-9 w-full min-w-0 rounded-lg border border-hairline bg-canvas px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-surface-soft disabled:text-muted-soft sm:w-auto sm:max-w-64"
                      onChange={(event) => updateRow(row.id, { cardId: event.target.value, cardError: undefined })}
                    >
                      <option value="">카드 선택</option>
                      {options.map((card) => <option key={card.id} value={card.id}>{card.label}</option>)}
                      <option value={NEW_CARD}>새 카드 추가</option>
                    </select>
                  ) : cardLabel && <span className="min-w-0 break-words text-sm text-body">{cardLabel}</span>}
                  <span className={`shrink-0 text-sm ${statusColor}`}>{STATUS_LABELS[row.status]}</span>
                  <div className="flex flex-wrap gap-2">
                    {row.status === "waiting" && <button type="button" disabled={running || row.addingCard} className={buttonClass("secondary", "sm")} onClick={() => { setRows((current) => current.filter((entry) => entry.id !== row.id)); setAnnouncement(`${row.file.name} 뺐어요`); }}>빼기</button>}
                    {row.status === "failed" && errorAction(row)}
                    {row.status === "complete" && row.result?.kind === "done" && (
                      <button type="button" disabled={running} className={buttonClass("secondary", "sm")} onClick={(event) => {
                        if (row.result?.kind === "done") setDeletion({ row: { ...row, result: { ...row.result, kind: "done" } }, opener: event.currentTarget });
                      }}>틀렸어요</button>
                    )}
                  </div>
                  {row.status === "waiting" && row.cardId === NEW_CARD && (
                    <form className="flex w-full min-w-0 flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void addCard(row); }}>
                      <input
                        aria-label="새 카드 이름" placeholder="예: 신한 생활비" maxLength={30} value={row.label} disabled={row.addingCard || running}
                        className="h-12 w-full min-w-0 rounded-xl border border-hairline bg-canvas px-4 text-base text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-surface-soft disabled:text-muted-soft sm:flex-1"
                        onChange={(event) => updateRow(row.id, { label: event.target.value, cardError: undefined })}
                      />
                      <button type="submit" disabled={row.addingCard || running} className={buttonClass("primary", "sm")}>{row.addingCard ? "추가 중…" : "추가"}</button>
                    </form>
                  )}
                  {row.cardError && <p className="w-full text-sm text-danger">{uploadErrorMessage(row.cardError.code, row.cardError.reason)}</p>}
                  {row.status === "failed" && row.error && <p className="w-full text-sm text-danger">{uploadErrorMessage(row.error.code, row.error.reason)}</p>}
                  {row.status === "complete" && row.result && (
                    <div className="w-full min-w-0 space-y-2 text-sm tabular-nums text-body">
                      <p>{resultLine(row.result)}</p>
                      {row.result.kind === "duplicate" && row.result.existingCardLabel && row.result.existingCardLabel !== cardLabel && (
                        <p>&apos;{row.result.existingCardLabel}&apos; 카드로 올렸던 파일이에요. 카드를 잘못 지정했다면 기존 업로드를 삭제하고 다시 올려 주세요</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</p>
      {deletion && <DeleteDialog {...deletion} onClose={() => setDeletion(null)} onDeleted={() => {
        updateRow(deletion.row.id, { status: "deleted", result: undefined });
        setAnnouncement(`${deletion.row.file.name} 삭제했어요`);
        setDeletion(null);
        router.refresh();
      }} />}
    </>
  );
}
