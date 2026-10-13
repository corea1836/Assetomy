import { addMonths, daysInMonth, monthOf } from "@/lib/analytics/dates";
import type { IsoDate } from "@/types/transaction";

export const RETENTION_MONTHS = 12;

export function retentionCutoff(today: IsoDate): IsoDate {
  const month = addMonths(monthOf(today), -RETENTION_MONTHS);
  const day = Math.min(Number(today.slice(8, 10)), daysInMonth(month));
  return `${month}-${String(day).padStart(2, "0")}`;
}
