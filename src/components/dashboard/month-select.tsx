"use client";

import { usePathname, useRouter } from "next/navigation";
import { formatMonth } from "@/lib/format";
import type { MonthOption } from "@/types/dashboard";
import type { YearMonth } from "@/types/transaction";

export function MonthSelect({
  months,
  month,
}: {
  months: MonthOption[];
  month: YearMonth;
}): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();

  return (
    // 제어 컴포넌트면 이동이 끝날 때까지 이전 달로 되돌아가 보여서, 새 month가 올 때만 다시 마운트한다.
    <select
      key={month}
      aria-label="월 선택"
      defaultValue={month}
      onChange={(event) =>
        router.push(`${pathname}?month=${event.currentTarget.value}`)
      }
      className="h-12 w-auto rounded-xl border border-hairline bg-canvas px-4 text-base text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-surface-soft disabled:text-muted-soft"
    >
      {months.map((option) => (
        <option key={option.month} value={option.month}>
          {formatMonth(option.month)}
        </option>
      ))}
    </select>
  );
}
