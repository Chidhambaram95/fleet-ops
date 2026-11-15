/** Dates are YYYY-MM-DD strings in Indian Standard Time throughout the app. */

export function todayInIst(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export function displayDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(year, month - 1, day));
}

export function isTodayInIst(date: string, now = new Date()): boolean {
  return date === todayInIst(now);
}

/** First day of the month a date falls in, plusMonths months later (negative for earlier). */
export function firstOfMonth(date: string, plusMonths = 0): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return new Date(Date.UTC(year, month - 1 + plusMonths, 1)).toISOString().slice(0, 10);
}

/** Last day of the month a date falls in. */
export function endOfMonth(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** "3 Nov 2026" from a YYYY-MM-DD date; other text is returned unchanged. */
export function shortDay(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return date;
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(year, month - 1, day),
  );
}
