import Link from "next/link";

export function CardTabs(props: {
  cards: { id: string; label: string }[];
  activeCardId: string | null;
}): React.JSX.Element {
  return (
    <nav aria-label="카드 보기" className="flex gap-2 overflow-x-auto">
      <Link
        href="/dashboard"
        aria-current={props.activeCardId === null ? "page" : undefined}
        className={`inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${props.activeCardId === null ? "bg-surface-strong text-ink" : "text-body hover:bg-surface-soft"}`}
      >
        전체
      </Link>
      {props.cards.map((card) => {
        const active = props.activeCardId === card.id;
        return (
          <Link
            key={card.id}
            href={`/dashboard?card=${encodeURIComponent(card.id)}`}
            aria-current={active ? "page" : undefined}
            title={card.label}
            className={`inline-flex h-9 max-w-48 shrink-0 items-center truncate rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${active ? "bg-surface-strong text-ink" : "text-body hover:bg-surface-soft"}`}
          >
            {card.label}
          </Link>
        );
      })}
    </nav>
  );
}
