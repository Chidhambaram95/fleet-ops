import type { Bus, DailyEntry, DayTotals } from "./types";

// Date and money helpers live in @domain/platform; re-exported so older imports keep working.
export { displayDate, isTodayInIst, shiftDate, todayInIst } from "@domain/platform/dates";
export { formatInr } from "@domain/platform/money";

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

