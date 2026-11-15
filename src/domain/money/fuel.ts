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
    const latest = pump.latest;
    if (
      !latest ||
      statement.statementOn > latest.statementOn ||
      (statement.statementOn === latest.statementOn && statement.createdAt > latest.createdAt)
    ) {
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
