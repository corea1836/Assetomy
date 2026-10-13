"use client";

import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { buttonClass } from "@/components/button-styles";
import { uploadErrorMessage } from "@/lib/errors/messages";
import { fetchJson, responseError, type UploadError } from "./api-reply";

export function DeleteUploadDialog({ uploadId, inserted, opener, onClose, onDeleted }: {
  uploadId: string;
  inserted: number;
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
    const reply = await fetchJson(`/api/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" });
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
          이 파일로 처음 저장된 거래 {inserted}건을 지워요. 다른 파일과 겹쳐서 제외됐던 거래는 되살아나지 않으니, 필요하면 그 파일을 다시 올려 주세요.
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
