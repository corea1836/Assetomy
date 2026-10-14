"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/button-styles";
import { fetchJson, responseError } from "@/components/upload/api-reply";
import { summaryFeedbackErrorMessage } from "@/lib/errors/messages";
import { feedbackLength, normalizeFeedback } from "@/lib/summary-feedback";
import { CATEGORY_LABELS, type CategoryId } from "@/types/category";
import { SUMMARY_FEEDBACK_MAX_LENGTH, type SummaryFeedbackRequest } from "@/types/summary";

const FEEDBACK_BUTTON_CLASS = "rounded-lg text-sm font-semibold text-body hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function TipFeedback({ category, initial }: { category: CategoryId; initial: string }): React.JSX.Element {
  const router = useRouter();
  const id = useId();
  const inputId = `${id}-feedback`;
  const errorId = `${id}-error`;
  const opener = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const wasOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [sourceInitial, setSourceInitial] = useState(initial);
  const [savedInitial, setSavedInitial] = useState(initial);
  const [value, setValue] = useState(initial);

  // router.refresh() can supply a newer server value while this component remains mounted.
  if (sourceInitial !== initial) {
    setSourceInitial(initial);
    setSavedInitial(initial);
    setValue(initial);
  }

  useEffect(() => {
    if (open) {
      input.current?.focus();
      wasOpen.current = true;
    } else if (wasOpen.current) {
      opener.current?.focus();
      wasOpen.current = false;
    }
  }, [open]);

  function startEditing() {
    setValue(savedInitial);
    setError(null);
    setAnnouncement("");
    setOpen(true);
  }

  function cancelEditing() {
    if (saving.current) return;
    setValue(savedInitial);
    setError(null);
    setOpen(false);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;

    saving.current = true;
    setBusy(true);
    setError(null);
    const request: SummaryFeedbackRequest = { category, text: value };
    const reply = await fetchJson("/api/summary-feedback", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (reply.status === 200) {
      const normalized = normalizeFeedback(value);
      setSavedInitial(normalized);
      setAnnouncement(normalized === "" ? "피드백을 지웠어요" : "저장했어요");
      setOpen(false);
      router.refresh();
    } else {
      setError(summaryFeedbackErrorMessage(responseError(reply.body).code));
    }

    saving.current = false;
    setBusy(false);
  }

  return (
    <div className="mt-1">
      {open && (
        <form className="mt-2 space-y-2" onSubmit={(event) => void save(event)}>
          <label htmlFor={inputId} className="text-sm text-ink">{CATEGORY_LABELS[category]} 피드백</label>
          <input
            ref={input}
            id={inputId}
            type="text"
            maxLength={SUMMARY_FEEDBACK_MAX_LENGTH}
            value={value}
            disabled={busy}
            aria-invalid={error !== null || undefined}
            aria-describedby={error !== null ? errorId : undefined}
            className={`h-12 w-full rounded-xl border ${error !== null ? "border-danger focus:border-danger focus:ring-danger" : "border-hairline focus:border-primary focus:ring-primary"} bg-canvas px-4 text-base text-ink placeholder:text-muted focus:outline-none focus:ring-1 disabled:bg-surface-soft disabled:text-muted-soft`}
            onChange={(event) => { setValue(event.target.value); setError(null); }}
          />
          {error !== null && <p id={errorId} role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 text-caption text-body">
              <p>피드백은 AI 요약에 함께 보내져요. 개인정보는 적지 마세요</p>
              <p>비우고 저장하면 피드백을 지워요</p>
            </div>
            <p className="shrink-0 text-caption tabular-nums text-body">
              {feedbackLength(normalizeFeedback(value))}/{SUMMARY_FEEDBACK_MAX_LENGTH}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={buttonClass("primary", "sm")}>{busy ? "저장 중…" : "저장"}</button>
            <button type="button" disabled={busy} onClick={cancelEditing} className={buttonClass("secondary", "sm")}>취소</button>
          </div>
        </form>
      )}
      {!open && savedInitial !== "" && <p className="text-sm text-body">내 피드백: {savedInitial}</p>}
      <button
        ref={opener}
        type="button"
        hidden={open}
        aria-expanded={open}
        onClick={startEditing}
        className={FEEDBACK_BUTTON_CLASS}
      >
        {savedInitial === "" ? "피드백 남기기" : "수정"}
      </button>
      <p aria-live="polite" aria-atomic="true" className="text-caption text-body">{announcement}</p>
    </div>
  );
}
