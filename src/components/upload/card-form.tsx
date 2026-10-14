"use client";

import { useId, useState } from "react";
import { buttonClass } from "@/components/button-styles";
import { uploadErrorMessage } from "@/lib/errors/messages";
import { ANALYSIS_BASES, CARD_ISSUERS, CARD_ISSUER_LABELS, type AnalysisBasis, type CardIssuer } from "@/types/card";
import type { CardOption, CreateCardResponse } from "@/types/upload";
import { z } from "zod";
import { fetchJson, responseError, type UploadError } from "./api-reply";
import { nextCardLabel } from "./next-card-label";

const cardSchema = z.object({ card: z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(30),
  issuer: z.enum(CARD_ISSUERS),
  analysisBasis: z.enum(ANALYSIS_BASES),
  cycleStartDay: z.int().min(1).max(31).nullable(),
}) });

export function CardForm(props: {
  cards: CardOption[];
  disabled: boolean;
  onPendingChange(pending: boolean): void;
  onCreated(card: CardOption): void;
}): React.JSX.Element {
  const id = useId();
  const issuerId = `${id}-issuer`;
  const labelId = `${id}-label`;
  const monthId = `${id}-month`;
  const cycleId = `${id}-cycle`;
  const cycleDayId = `${id}-cycle-day`;
  const errorId = `${id}-error`;
  const [issuer, setIssuer] = useState<CardIssuer>("hyundai");
  const [editedLabel, setEditedLabel] = useState<string | null>(null);
  const [analysisBasis, setAnalysisBasis] = useState<AnalysisBasis>("month");
  const [cycleDay, setCycleDay] = useState("");
  const [error, setError] = useState<UploadError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const label = editedLabel ?? nextCardLabel(issuer, props.cards);
  const suggestedHelp = "12일이면 12일부터 다음 달 11일까지를 한 명세서로 봐요";
  const numericCycleDay = /^\d+$/.test(cycleDay) && cycleDay.trim() === cycleDay ? Number(cycleDay) : NaN;
  const validCycleDay = Number.isInteger(numericCycleDay) && numericCycleDay >= 1 && numericCycleDay <= 31;
  const cycleHelp = validCycleDay
    ? numericCycleDay === 1 ? "1일부터 그달 말일까지를 한 명세서로 봐요"
      : `${numericCycleDay}일부터 다음 달 ${numericCycleDay - 1}일까지를 한 명세서로 봐요`
    : suggestedHelp;
  const disabled = props.disabled || submitting;
  const errorMessage = error ? uploadErrorMessage(error.code, error.reason) : null;
  const labelHasError = error?.code === "INVALID_LABEL";
  const cycleHasError = analysisBasis === "cycle" && error?.code === "INVALID_CARD";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setError(null);
    const trimmedLabel = label.trim();
    if (trimmedLabel.length < 1 || trimmedLabel.length > 30) {
      setError({ code: "INVALID_LABEL" });
      return;
    }
    if (analysisBasis === "cycle" && !validCycleDay) {
      setError({ code: "INVALID_CARD" });
      return;
    }

    const cycleStartDay = analysisBasis === "month" ? null : numericCycleDay;
    setSubmitting(true);
    props.onPendingChange(true);
    try {
      const reply = await fetchJson("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmedLabel, issuer, analysisBasis, cycleStartDay }),
      });
      const parsed = cardSchema.safeParse(reply.body);
      if (reply.status === 201 && parsed.success) {
        props.onCreated(parsed.data.card satisfies CreateCardResponse["card"]);
      } else {
        setError(responseError(reply.body));
      }
    } finally {
      setSubmitting(false);
      props.onPendingChange(false);
    }
  }

  return (
    <form className="w-full min-w-0 space-y-3" onSubmit={(event) => { void submit(event); }}>
      <div className="min-w-0 space-y-1">
        <label htmlFor={issuerId} className="text-sm text-ink">카드사</label>
        <select
          id={issuerId}
          value={issuer}
          disabled={disabled}
          aria-describedby={error?.code === "INVALID_CARD" && analysisBasis === "month" ? errorId : undefined}
          className="h-12 w-full min-w-0 rounded-xl border border-hairline bg-canvas px-4 text-base text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-surface-soft disabled:text-muted-soft"
          onChange={(event) => { setIssuer(event.target.value as CardIssuer); setError(null); }}
        >
          {CARD_ISSUERS.map((cardIssuer) => <option key={cardIssuer} value={cardIssuer}>{CARD_ISSUER_LABELS[cardIssuer]}</option>)}
        </select>
      </div>
      <div className="min-w-0 space-y-1">
        <label htmlFor={labelId} className="text-sm text-ink">카드 이름</label>
        <input
          id={labelId}
          type="text"
          maxLength={30}
          value={label}
          disabled={disabled}
          aria-invalid={labelHasError || undefined}
          aria-describedby={labelHasError ? errorId : undefined}
          className="h-12 w-full min-w-0 rounded-xl border border-hairline bg-canvas px-4 text-base text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-surface-soft disabled:text-muted-soft"
          onChange={(event) => { setEditedLabel(event.target.value); setError(null); }}
        />
      </div>
      <fieldset className="min-w-0" aria-describedby={error?.code === "INVALID_CARD" ? errorId : undefined}>
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
              aria-invalid={cycleHasError || undefined}
              aria-describedby={cycleHasError ? errorId : undefined}
              value={cycleDay}
              disabled={disabled}
              className="h-12 w-24 min-w-0 rounded-xl border border-hairline bg-canvas px-4 text-base text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-surface-soft disabled:text-muted-soft"
              onChange={(event) => { setCycleDay(event.target.value); setError(null); }}
            />
            <span className="text-sm text-ink">일부터</span>
          </div>
          <p className="text-caption text-body">{cycleHelp}</p>
        </div>
      )}
      <button type="submit" disabled={disabled} className={buttonClass("primary", "sm")}>
        {submitting ? "추가 중…" : "추가"}
      </button>
      {errorMessage && <p id={errorId} role="alert" className="text-sm text-danger">{errorMessage}</p>}
    </form>
  );
}
