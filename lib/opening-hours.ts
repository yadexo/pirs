/** Location.openingHours: per weekday either open/close times or null (closed). */

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export type OpeningHours = Record<Weekday, { open: string; close: string } | null>;

export function isOpeningHours(value: unknown): value is OpeningHours {
  if (!value || typeof value !== "object") return false;
  return WEEKDAYS.every((d) => {
    const v = (value as Record<string, unknown>)[d];
    return v === null || (typeof v === "object" && v !== null && typeof (v as { open?: unknown }).open === "string");
  });
}

/** "Open today 09:00–17:00" / "Closed today", in the clinic's time zone. */
export function todaysHours(hours: unknown, timeZone: string, now = new Date()): string | null {
  if (!isOpeningHours(hours)) return null;
  const short = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(now).toLowerCase().slice(0, 3);
  const today = hours[short as Weekday];
  return today ? `Open today ${today.open}–${today.close}` : "Closed today";
}
