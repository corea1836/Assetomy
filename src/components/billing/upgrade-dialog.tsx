"use client";

import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { buttonClass } from "@/components/button-styles";
import { sendMetric } from "@/components/send-metric";
import { FINDING_KIND_LABELS } from "@/components/dashboard/finding-labels";
import { fetchJson, responseError } from "@/components/upload/api-reply";
import { billingErrorMessage } from "@/lib/errors/messages";
import { formatWon } from "@/lib/format";
import { PRO_PRICE_KRW, PRO_PRICE_USD_LABEL } from "@/lib/pricing";
import type { UpgradeSource } from "@/types/billing";
import type { FindingKind, Teaser } from "@/types/dashboard";
import type { ApiErrorCode } from "@/types/upload";

const EXAMPLES: { kind: FindingKind; merchant: string; amount: number }[] = [
  { kind: "recurring", merchant: "예시 OTT", amount: 14_900 },
  { kind: "duplicate", merchant: "예시 상점", amount: 32_000 },
];
const urlSchema = z.object({ url: z.string() });

export function UpgradeDialog({ source, opener, onClose, teaser }: {
  source: UpgradeSource;
  opener: HTMLElement | null;
  onClose: () => void;
  teaser?: Teaser | null;
}): React.JSX.Element {
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const paying = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const candidateCount = teaser ? Object.values(teaser.byKind).reduce((sum, { count }) => sum + count, 0) : 0;

  useEffect(() => {
    sendMetric({ event: "upgrade_click", source });
  }, [source]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [opener]);

  async function checkout() {
    if (paying.current) return;
    paying.current = true;
    setBusy(true);
    setError(null);
    const reply = await fetchJson("/api/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source }),
    });
    const parsed = urlSchema.safeParse(reply.body);
    if (reply.status === 200 && parsed.success) {
      window.location.assign(parsed.data.url);
      return;
    }
    setError(responseError(reply.body).code);
    paying.current = false;
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
            if (!paying.current) onClose();
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
        <h2 id={titleId} className="text-lg font-semibold text-ink">Pro에서 확인할 지출 상세를 볼 수 있어요</h2>
        {teaser && candidateCount > 0 && (
          <p className="mt-4 text-sm tabular-nums text-ink">
            {`내 이용내역에서 확인이 필요한 지출 ${candidateCount}건 · 후보 합계 ${formatWon(teaser.candidateTotal)}`}
          </p>
        )}
        <ul className="mt-5 space-y-3 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {EXAMPLES.map(({ kind, merchant, amount }) => (
            <li key={kind} className="flex flex-wrap items-start justify-between gap-2">
              <span>{FINDING_KIND_LABELS[kind]} · {merchant}</span>
              <span className="font-mono">{formatWon(amount)}</span>
            </li>
          ))}
        </ul>
        <p id={descriptionId} className="mt-2 text-caption text-body">예시 화면이에요. 실제 내 데이터가 아니에요.</p>
        <p className="mt-6 text-title-lg tabular-nums text-ink">월 {formatWon(PRO_PRICE_KRW)}</p>
        <p className="mt-2 text-caption text-body">해외에서는 {PRO_PRICE_USD_LABEL}로 결제돼요</p>
        <p className="mt-4 text-caption text-body">설정에서 언제든 해지할 수 있어요. 남은 기간까지 Pro로 써요</p>
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-danger">{billingErrorMessage(error)}</p>}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={busy} onClick={() => void checkout()} className={`${buttonClass("primary")} w-full sm:order-2 sm:w-auto`}>
            {busy ? "결제 화면 여는 중…" : "결제하기"}
          </button>
          <button type="button" disabled={busy} onClick={onClose} className={`${buttonClass("secondary")} w-full sm:w-auto`}>닫기</button>
        </div>
      </div>
    </div>
  );
}
