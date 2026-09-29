import type { Bus, DailyEntry, DayTotals } from "./types";

export function emptyTotals(): DayTotals {
  return { incomeInr: 0, expenseInr: 0, netInr: 0 };
}

export function totalsForEntries(entries: DailyEntry[]): DayTotals {
  const incomeInr = entries
    .filter((entry) => entry.kind === "income")
    .reduce((sum, entry) => sum + entry.amountInr, 0);
  const expenseInr = entries
    .filter((entry) => entry.kind === "expense")
    .reduce((sum, entry) => sum + entry.amountInr, 0);

  return {
    incomeInr,
    expenseInr,
    netInr: incomeInr - expenseInr,
  };
}

export function totalsByBus(
  buses: Bus[],
  entries: DailyEntry[],
): Map<string, DayTotals> {
  const map = new Map<string, DayTotals>();
  for (const bus of buses) {
    map.set(
      bus.id,
      totalsForEntries(entries.filter((entry) => entry.busId === bus.id)),
    );
  }
  return map;
}

export function formatInr(amount: number): string {
  const formatted = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));

  return amount < 0 ? `−${formatted}` : formatted;
}

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
