"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { buttonClass } from "@/components/button-styles";
import { cardEditErrorMessage } from "@/lib/errors/messages";
import { CARD_ISSUER_LABELS, type AnalysisBasis } from "@/types/card";
import type { CardOption } from "@/types/upload";
import { fetchJson, responseError, type UploadError } from "../upload/api-reply";

function CardEditDialog({ card, opener, onClose }: {
  card: CardOption;
  opener: HTMLButtonElement;
  onClose: () => void;
}): React.JSX.Element {
  const router = useRouter();
  const id = useId();
  const titleId = `${id}-title`;
  const labelId = `${id}-label`;
  const monthId = `${id}-month`;
  const cycleId = `${id}-cycle`;
  const cycleDayId = `${id}-cycle-day`;
  const panel = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState(card.label);
  const [analysisBasis, setAnalysisBasis] = useState<AnalysisBasis>(card.analysisBasis);
  const [cycleDay, setCycleDay] = useState(card.cycleStartDay === null ? "" : String(card.cycleStartDay));
  const [error, setError] = useState<UploadError | null>(null);
  const disabled = busy;
  const trimmedLabel = label.trim();
  const numericCycleDay = /^\d+$/.test(cycleDay) && cycleDay.trim() === cycleDay ? Number(cycleDay) : NaN;
  const validCycleDay = Number.isInteger(numericCycleDay) && numericCycleDay >= 1 && numericCycleDay <= 31;
  const cycleHelp = validCycleDay
    ? numericCycleDay === 1 ? "1일부터 그달 말일까지를 한 명세서로 봐요"
      : `${numericCycleDay}일부터 다음 달 ${numericCycleDay - 1}일까지를 한 명세서로 봐요`
    : "12일이면 12일부터 다음 달 11일까지를 한 명세서로 봐요";
  const basisChanged = analysisBasis !== card.analysisBasis
    || (analysisBasis === "cycle" && numericCycleDay !== card.cycleStartDay);
  const labelError = error?.code === "INVALID_LABEL" || error?.code === "DUPLICATE_LABEL";
  const cycleError = error?.code === "INVALID_CARD" && analysisBasis === "cycle";
  const basisError = error?.code === "INVALID_CARD" && analysisBasis === "month";
  const errorId = `${id}-error`;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      opener.focus();
    };
  }, [opener]);

  async function save() {
    if (saving.current) return;
    setError(null);
    if (trimmedLabel.length < 1 || trimmedLabel.length > 30) {
      setError({ code: "INVALID_LABEL" });
      return;
    }
    if (analysisBasis === "cycle" && !validCycleDay) {
      setError({ code: "INVALID_CARD" });
      return;
    }

    saving.current = true;
    setBusy(true);
    try {
      const cycleStartDay = analysisBasis === "month" ? null : numericCycleDay;
      const reply = await fetchJson(`/api/cards/${encodeURIComponent(card.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: trimmedLabel, analysisBasis, cycleStartDay }),
      });
      const parsed = zUpdated.safeParse(reply.body);
      if (reply.status === 200 && parsed.success) {
        onClose();
        router.refresh();
      } else {
        setError(responseError(reply.body));
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-surface-dark/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving.current) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        tabIndex={-1}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-3xl bg-canvas p-6 focus-visible:outline-2 focus-visible:outline-primary sm:p-8"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (!saving.current) onClose();
          }
          if (event.key !== "Tab") return;
          const controls = panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
          if (!controls?.length) { event.preventDefault(); return; }
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <h2 id={titleId} className="text-lg font-semibold text-ink">카드 수정</h2>
        <p className="mt-3 text-sm text-body">카드사 {CARD_ISSUER_LABELS[card.issuer]} · 바꿀 수 없어요</p>
        <div className="mt-4 space-y-3">
          <div className="min-w-0 space-y-1">
            <label htmlFor={labelId} className="text-sm text-ink">카드 이름</label>
            <input
              id={labelId}
              type="text"
              maxLength={30}
              value={label}
              disabled={disabled}
              aria-invalid={labelError || undefined}
              aria-describedby={labelError ? errorId : undefined}
              className="h-12 w-full rounded-xl border border-hairline bg-canvas px-4 text-base text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-surface-soft disabled:text-muted-soft"
              onChange={(event) => { setLabel(event.target.value); setError(null); }}
            />
            {labelError && <p id={errorId} role="alert" className="text-sm text-danger">{cardEditErrorMessage(error.code)}</p>}
          </div>
          <fieldset className="min-w-0" aria-describedby={basisError ? errorId : undefined}>
            <legend className="text-sm font-semibold text-ink">분석 기준</legend>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
              <label htmlFor={monthId} className="inline-flex items-center gap-2 text-sm text-ink">
                <input
                  id={monthId}
                  type="radio"
                  name={`${id}-analysis-basis`}
                  value="month"
                  checked={analysisBasis === "month"}
                  disabled={disabled}
                  className="size-4 accent-primary"
                  onChange={() => { setAnalysisBasis("month"); setError(null); }}
                />
                월별
              </label>
              <label htmlFor={cycleId} className="inline-flex items-center gap-2 text-sm text-ink">
                <input
                  id={cycleId}
                  type="radio"
                  name={`${id}-analysis-basis`}
                  value="cycle"
                  checked={analysisBasis === "cycle"}
                  disabled={disabled}
                  className="size-4 accent-primary"
                  onChange={() => { setAnalysisBasis("cycle"); setError(null); }}
                />
                이용 기간
              </label>
            </div>
            {basisError && <p id={errorId} role="alert" className="mt-2 text-sm text-danger">{cardEditErrorMessage(error.code)}</p>}
          </fieldset>
          {analysisBasis === "cycle" && (
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <label htmlFor={cycleDayId} className="text-sm text-ink">매달</label>
                <input
                  id={cycleDayId}
                  type="text"
                  inputMode="numeric"
                  aria-label="이용 기간 시작일"
                  aria-invalid={cycleError || undefined}
                  aria-describedby={cycleError ? errorId : undefined}
                  value={cycleDay}
                  disabled={disabled}
                  className="h-12 w-24 min-w-0 rounded-xl border border-hairline bg-canvas px-4 text-base text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-surface-soft disabled:text-muted-soft"
                  onChange={(event) => { setCycleDay(event.target.value); setError(null); }}
                />
                <span className="text-sm text-ink">일부터</span>
              </div>
              {cycleError && <p id={errorId} role="alert" className="text-sm text-danger">{cardEditErrorMessage(error.code)}</p>}
              <p className="text-caption text-body">{cycleHelp}</p>
            </div>
          )}
          {basisChanged && <p className="text-caption text-body">분석 기준을 바꾸면 이 카드 요약을 다시 만들어요</p>}
        </div>
        {error && !labelError && !cycleError && !basisError && (
          <p id={errorId} role="alert" className="mt-4 text-sm text-danger">{cardEditErrorMessage(error.code)}</p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="submit" disabled={disabled} className={`${buttonClass("primary")} w-full sm:order-2 sm:w-auto`}>
            {busy ? "저장 중…" : "저장"}
          </button>
          <button type="button" disabled={disabled} onClick={onClose} className={`${buttonClass("secondary")} w-full sm:order-1 sm:w-auto`}>취소</button>
        </div>
      </form>
      </div>
    </div>
  );
}

const zUpdated = z.object({ updated: z.literal(true) });

export function CardEditButton({ card }: { card: CardOption }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        type="button"
        className={buttonClass("secondary", "sm")}
        onClick={(event) => { setOpener(event.currentTarget); setOpen(true); }}
      >
        카드 수정
      </button>
      {open && opener && (
        <CardEditDialog card={card} opener={opener} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
