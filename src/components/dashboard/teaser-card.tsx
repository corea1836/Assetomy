"use client";

import { useEffect } from "react";
import { UpgradeButton } from "@/components/billing/upgrade-button";
import { sendMetric } from "@/components/send-metric";
import { formatWon } from "@/lib/format";
import type { FindingKind, Teaser } from "@/types/dashboard";
import { FINDING_KIND_LABELS } from "./finding-labels";

const FINDING_KINDS: FindingKind[] = ["recurring", "duplicate", "large"];

export function TeaserCard({ teaser, dataMonthCount }: {
  teaser: Teaser;
  dataMonthCount: number;
}): React.JSX.Element {
  const hasCandidates = Object.values(teaser.byKind).some(({ count }) => count > 0);
  useEffect(() => {
    if (hasCandidates) sendMetric({ event: "teaser_seen" });
  }, [hasCandidates]);

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold text-ink">확인이 필요한 지출</h2>
      {hasCandidates ? (
        <>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900 sm:p-8">
            <ul aria-label="탐지 종류별 요약" className="space-y-3">
              {FINDING_KINDS.map((kind) => (
                <li key={kind} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span>{FINDING_KIND_LABELS[kind]}</span>
                  <span className="text-right font-mono">
                    {teaser.byKind[kind].count}건 · {formatWon(teaser.byKind[kind].amount)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-base font-semibold">
              후보 합계 <span className="font-mono">{formatWon(teaser.candidateTotal)}</span>
            </p>
            <p className="mt-2 text-caption text-body">
              같은 거래는 한 번만 셌어요. 정상 지출일 수 있어요. 상세에서 확인해 보세요.
            </p>
          </div>
          <UpgradeButton source="teaser" label="Pro로 보기" teaser={teaser} />
        </>
      ) : (
        <p className="text-base text-body">이번 규칙으로 확인할 지출 후보가 발견되지 않았어요</p>
      )}
      {dataMonthCount < 2 && (
        <p className="text-caption text-body">한 달치만 더 올리면 정기결제를 찾아드려요</p>
      )}
    </section>
  );
}
