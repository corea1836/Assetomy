"use client";

import { usePathname, useRouter } from "next/navigation";

export function PeriodSelect(props: {
  cardId: string;
  param: "month" | "statement";
  value: string;
  options: { value: string; label: string }[];
  ariaLabel: string;
}): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <select
      key={props.value}
      aria-label={props.ariaLabel}
      defaultValue={props.value}
      onChange={(event) => {
        const params = new URLSearchParams();
        params.set("card", props.cardId);
        params.set(props.param, event.currentTarget.value);
        router.push(`${pathname}?${params.toString()}`);
      }}
      className="h-12 w-auto rounded-xl border border-hairline bg-canvas px-4 text-base text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-surface-soft disabled:text-muted-soft"
    >
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}
