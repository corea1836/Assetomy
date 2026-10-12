const steps = [
  {
    title: "카드사에서 이용내역 받기",
    description: "카드사 홈페이지에서 신용카드 이용내역(승인내역)을 엑셀이나 CSV 파일로 받아요. 청구서가 아니라 이용내역이에요.",
  },
  {
    title: "파일마다 카드 고르기",
    description: "‘생활비 카드’처럼 이름을 붙여 카드별로 나눠 봐요. 카드번호는 받지 않아요.",
  },
  {
    title: "올리고 확인하기",
    description: "최근 3개월치를 올리면 총지출·카테고리와 함께 정기결제까지 찾아드려요.",
  },
];

export function StartSteps({ cardLabel }: { cardLabel: string }): React.JSX.Element {
  return (
    <ol aria-label="시작하는 순서" className="reveal mt-10 grid gap-10 sm:grid-cols-3 sm:gap-6">
      {steps.map(({ title, description }, index) => (
        <li key={title} className="relative min-w-0 pl-8 sm:pl-0">
          {index < steps.length - 1 && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-8 left-2 top-7 w-px bg-hairline sm:-right-4 sm:bottom-auto sm:left-8 sm:top-2.5 sm:h-px sm:w-auto"
            />
          )}
          <p className="absolute left-0 top-0 font-mono text-sm text-primary sm:static">
            {String(index + 1).padStart(2, "0")}
          </p>
          <div
            aria-hidden="true"
            className="mt-8 flex h-24 min-w-0 items-center rounded-2xl border border-hairline bg-canvas p-4"
          >
            {index === 0 && (
              <div className="flex flex-wrap gap-3">
                {["XLSX", "CSV"].map((format) => (
                  <span key={format} className="rounded-lg bg-surface-soft px-3 py-2 text-sm font-semibold text-ink">
                    {format}
                  </span>
                ))}
              </div>
            )}
            {index === 1 && (
              <span className="min-w-0 max-w-full break-words rounded-full bg-surface-soft px-4 py-2 text-sm text-ink">
                {cardLabel}
              </span>
            )}
            {index === 2 && (
              <div className="flex h-14 w-full items-end gap-3">
                {["50%", "85%", "65%"].map((height) => (
                  <div key={height} className="max-w-6 min-w-0 flex-1 rounded-t-[4px] bg-primary" style={{ height }} />
                ))}
              </div>
            )}
          </div>
          <h3 className="mt-5 text-lg font-semibold text-ink">{title}</h3>
          <p className="mt-3 text-base leading-relaxed text-body">{description}</p>
        </li>
      ))}
    </ol>
  );
}
