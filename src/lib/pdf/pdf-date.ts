import { daysInMonth } from "@/lib/analytics/dates";

export function parsePdfDate(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const match = value.match(
    /^(?:D:)?(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(Z(?:00'00'?)?|([+-])(\d{2})(?:'(\d{2})'?|(\d{2})))$/,
  );
  if (!match) return null;

  const [, year, month, day, hour, minute, second, zone, sign, zoneHour, quotedMinute, plainMinute] = match;
  const yearMonth = year + "-" + month;
  if (
    Number(month) < 1 || Number(month) > 12 ||
    Number(day) < 1 || Number(day) > daysInMonth(yearMonth) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  ) {
    return null;
  }

  const timestamp = year + "-" + month + "-" + day + "T" + hour + ":" + minute + ":" + second;
  if (zone === "Z" || zone.startsWith("Z")) return timestamp + "Z";

  const offsetMinute = quotedMinute ?? plainMinute;
  if (Number(zoneHour) > 23 || Number(offsetMinute) > 59) return null;
  return timestamp + sign + zoneHour + ":" + offsetMinute;
}
