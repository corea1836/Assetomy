"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/button-styles";
import { formatPeriod } from "@/lib/format";
import type { UploadHistoryItem } from "@/types/upload";
import { DeleteUploadDialog } from "./delete-upload-dialog";

export function UploadHistory({ uploads }: { uploads: UploadHistoryItem[] }): React.JSX.Element | null {
  const router = useRouter();
  const [deletion, setDeletion] = useState<{ upload: UploadHistoryItem; opener: HTMLButtonElement } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  if (uploads.length === 0 && !announcement) return null;

  return (
    <section>
      <div inert={deletion !== null}>
        {uploads.length > 0 && (
          <>
            <h2 className="text-lg font-semibold text-ink">올린 파일</h2>
            <ul aria-label="올린 파일" className="mt-3 min-w-0">
              {uploads.map((upload) => (
                <li key={upload.id} className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline-soft px-2 py-3">
                  <span className="min-w-0 basis-full truncate text-sm text-ink sm:flex-1 sm:basis-0" title={upload.fileName}>{upload.fileName}</span>
                  {upload.cardLabel && <span className="min-w-0 break-words text-sm text-body">{upload.cardLabel}</span>}
                  <span className="text-sm tabular-nums text-body">
                    {`${upload.inserted}건 · ${formatPeriod({ from: upload.periodFrom, to: upload.periodTo })}`}
                  </span>
                  <button
                    type="button" aria-label={`${upload.fileName} 삭제`} className={buttonClass("secondary", "sm")}
                    onClick={(event) => setDeletion({ upload, opener: event.currentTarget })}
                  >
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <p aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</p>
      {deletion && <DeleteUploadDialog
        uploadId={deletion.upload.id} inserted={deletion.upload.inserted} opener={deletion.opener}
        onClose={() => setDeletion(null)}
        onDeleted={() => {
          setAnnouncement(`${deletion.upload.fileName} 삭제했어요`);
          setDeletion(null);
          router.refresh();
        }}
      />}
    </section>
  );
}
