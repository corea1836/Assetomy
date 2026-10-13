"use client";

import { useRef, useState } from "react";
import { z } from "zod";
import { buttonClass } from "@/components/button-styles";
import { fetchJson, responseError } from "@/components/upload/api-reply";
import { billingErrorMessage } from "@/lib/errors/messages";
import type { ApiErrorCode } from "@/types/upload";

const urlSchema = z.object({ url: z.string() });

export function ManageSubscriptionButton(): React.JSX.Element {
  const opening = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorCode | null>(null);

  async function manage() {
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    setError(null);
    const reply = await fetchJson("/api/portal", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const parsed = urlSchema.safeParse(reply.body);
    if (reply.status === 200 && parsed.success) {
      window.location.assign(parsed.data.url);
      return;
    }
    setError(responseError(reply.body).code);
    opening.current = false;
    setBusy(false);
  }

  return (
    <div>
      <button type="button" disabled={busy} onClick={() => void manage()} className={buttonClass("secondary")}>
        {busy ? "구독 관리 화면 여는 중…" : "구독 관리"}
      </button>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-danger">{billingErrorMessage(error)}</p>}
    </div>
  );
}
