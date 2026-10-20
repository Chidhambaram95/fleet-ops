import type { Trip } from "@domain/trips/types";
import { pumpKey } from "./catalog";
import type { PumpPayment, PumpStatement } from "./types";

export type PumpBalance = {
  pump: string;
  /** Credit diesel on approved trip sheets. */
  creditInr: number;
  creditLitres: number;
  paidInr: number;
  /** What the trip sheets say is still owed: credit minus payments. */
  expectedInr: number;
  latest: PumpStatement | null;
  /** Pump's figure minus ours. Positive: the pump asks for more than the sheets show. */
  differenceInr: number | null;
};

/** Credit owed to each pump, from approved trips, payments and the pump's own figure. */
export function pumpBalances(
  trips: Trip[],
  payments: PumpPayment[],
  statements: PumpStatement[],
): PumpBalance[] {
  const byPump = new Map<string, PumpBalance>();
  const entry = (name: string) => {
    const key = pumpKey(name) || "unnamed pump";
    let found = byPump.get(key);
    if (!found) {
      found = {
        pump: name.trim() || "Unnamed pump",
        creditInr: 0,
        creditLitres: 0,
        paidInr: 0,
        expectedInr: 0,
        latest: null,
        differenceInr: null,
      };
      byPump.set(key, found);
    }
    return found;
  };

  for (const trip of trips) {
    if (trip.status !== "approved") continue;
    for (const fill of trip.diesel) {
      if (fill.paidBy !== "credit") continue;
      const pump = entry(fill.pump);
      pump.creditInr += fill.amountInr;
      pump.creditLitres += fill.litres ?? 0;
    }
  }
  for (const payment of payments) {
    entry(payment.pump).paidInr += payment.amountInr;
  }
  for (const statement of statements) {
    const pump = entry(statement.pump);
    if (!pump.latest || statement.statementOn > pump.latest.statementOn) {
      pump.latest = statement;
    }
  }
  return [...byPump.values()]
    .map((pump) => {
      const expectedInr = pump.creditInr - pump.paidInr;
      return {
        ...pump,
        expectedInr,
        differenceInr: pump.latest ? pump.latest.outstandingInr - expectedInr : null,
      };
    })
    .sort((left, right) => right.expectedInr - left.expectedInr);
}

export type BusMileage = {
  busId: string;
  trips: number;
  km: number;
  litres: number;
  /** Over all approved trips with km and litres. */
  usual: number | null;
  /** The most recent such trip. */
  last: number | null;
  lastSheetNo: string;
  low: boolean;
};

/** Km per litre per bus; flags a bus whose last trip is well below its usual. */
export function busMileage(trips: Trip[]): BusMileage[] {
  const byBus = new Map<string, { trip: Trip; km: number; litres: number }[]>();
  for (const trip of trips) {
    if (trip.status !== "approved" || trip.startKm == null || trip.endKm == null) continue;
    const litres = trip.diesel.reduce((total, fill) => total + (fill.litres ?? 0), 0);
    const km = trip.endKm - trip.startKm;
    if (litres <= 0 || km <= 0) continue;
    const list = byBus.get(trip.busId) ?? [];
    list.push({ trip, km, litres });
    byBus.set(trip.busId, list);
  }
  return [...byBus.entries()].map(([busId, list]) => {
    list.sort((left, right) => (right.trip.startedAt ?? "").localeCompare(left.trip.startedAt ?? ""));
    const km = list.reduce((total, item) => total + item.km, 0);
    const litres = list.reduce((total, item) => total + item.litres, 0);
    const usual = litres > 0 ? km / litres : null;
    const last = list[0] ? list[0].km / list[0].litres : null;
    return {
      busId,
      trips: list.length,
      km,
      litres,
      usual,
      last,
      lastSheetNo: list[0]?.trip.sheetNo ?? "",
      low: list.length >= 3 && usual != null && last != null && last < usual * 0.85,
    };
  });
}
