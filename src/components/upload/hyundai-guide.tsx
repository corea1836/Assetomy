export function HyundaiGuide(): React.JSX.Element {
  return (
    <details id="guide-hyundai" className="mt-3">
      <summary className="inline-flex cursor-pointer items-center rounded-lg py-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        현대카드 이용내역 받는 법
      </summary>
      <div className="mt-2 space-y-2 text-sm text-body">
        <p>앱이나 웹의 명세서에서 &apos;이용 내역&apos;을 최근순으로 두고 PDF로 저장해 주세요.</p>
        <p>할부나 취소 표시가 있는 명세서는 아직 읽지 못해요.</p>
      </div>
    </details>
  );
}
