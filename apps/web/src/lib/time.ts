import { formatInTimeZone } from "date-fns-tz";
import { nb } from "date-fns/locale";

const DEFAULT_TZ = "Europe/Oslo";

export function formatEventDate(
  date: Date | string,
  timezone: string = DEFAULT_TZ,
  pattern = "EEEE d. MMMM yyyy"
): string {
  return formatInTimeZone(new Date(date), timezone, pattern, { locale: nb });
}

export function formatEventTime(
  date: Date | string,
  timezone: string = DEFAULT_TZ,
  pattern = "HH:mm"
): string {
  return formatInTimeZone(new Date(date), timezone, pattern, { locale: nb });
}

export function formatEventDateTime(
  date: Date | string,
  timezone: string = DEFAULT_TZ
): string {
  return formatInTimeZone(new Date(date), timezone, "d. MMM yyyy 'kl.' HH:mm", {
    locale: nb,
  });
}

export { DEFAULT_TZ };
