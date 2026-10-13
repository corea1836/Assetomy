"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchJson, responseError } from "@/components/upload/api-reply";
import { categoryErrorMessage } from "@/lib/errors/messages";
import { CATEGORY_IDS, CATEGORY_LABELS, type CategoryId, type MerchantCategoryRequest } from "@/types/category";

export function MerchantCategorySelect({ merchantKey, merchant, category }: {
  merchantKey: string;
  merchant: string;
  category: CategoryId;
}): React.JSX.Element {
  const router = useRouter();
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState({ source: category, value: category });
  const [announcement, setAnnouncement] = useState("");

  // 새로고침으로 서버에서 받은 카테고리를 반영한다.
  if (selection.source !== category) setSelection({ source: category, value: category });

  async function save(nextCategory: CategoryId) {
    if (saving.current || nextCategory === selection.value) return;
    saving.current = true;
    const previous = selection.value;
    setBusy(true);
    setSelection({ source: category, value: nextCategory });
    setAnnouncement("저장 중…");
    const request: MerchantCategoryRequest = { merchantKey, category: nextCategory };
    const reply = await fetchJson("/api/merchant-categories", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
    });
    if (reply.status === 200) {
      setAnnouncement("저장했어요");
      router.refresh();
    } else {
      setSelection({ source: category, value: previous });
      setAnnouncement(categoryErrorMessage(responseError(reply.body).code));
    }
    saving.current = false;
    setBusy(false);
  }

  return (
    <div className="min-w-0 max-w-full">
      <select
        aria-label={`${merchant} 카테고리`} value={selection.value} disabled={busy}
        onChange={(event) => void save(event.currentTarget.value as CategoryId)}
        className="h-9 w-full min-w-0 rounded-lg border border-hairline bg-canvas px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-surface-soft disabled:text-muted-soft"
      >
        {CATEGORY_IDS.map((id) => <option key={id} value={id}>{CATEGORY_LABELS[id]}</option>)}
      </select>
      <p aria-live="polite" aria-atomic="true" className="text-caption text-body">{announcement}</p>
    </div>
  );
}
