import { UpgradeButton } from "@/components/billing/upgrade-button";

const EXAMPLE_HEIGHTS = [45, 65, 50, 80];

export function TrendLockCard(): React.JSX.Element {
  return (
    <section className="rounded-3xl bg-surface-soft p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-ink">월별 추세</h2>
      <div aria-hidden="true" className="mt-6 flex h-32 max-w-xs items-end gap-4">
        {EXAMPLE_HEIGHTS.map((height, index) => (
          <div key={index} className="max-w-6 flex-1 rounded-t-[4px] bg-primary" style={{ height: `${height}%` }} />
        ))}
      </div>
      <p className="mt-3 text-caption text-body">예시 그림이에요. 실제 내 데이터가 아니에요.</p>
      <p className="mt-4 text-base text-body">Pro에서는 여러 달 지출 추세와 지난달과 달라진 카테고리를 볼 수 있어요</p>
      <div className="mt-6"><UpgradeButton source="trend" label="Pro로 보기" /></div>
    </section>
  );
}
