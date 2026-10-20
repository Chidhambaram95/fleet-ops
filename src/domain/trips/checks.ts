import { formatInr } from "@domain/operations/totals";
import type { DieselFill, TripExpense } from "./types";

export type TripFigures = {
  startKm: number | null;
  endKm: number | null;
  advanceInr: number;
  writtenTotalInr: number | null;
  startedAt: string | null;
  endedAt: string | null;
  diesel: DieselFill[];
  expenses: TripExpense[];
};

export type TripTotals = {
  kmRun: number | null;
  dieselLitres: number;
  dieselInr: number;
  cashDieselInr: number;
  creditDieselInr: number;
  cashExpensesInr: number;
  /** Everything the crew paid from the advance: cash expenses and cash diesel. */
  cashSpentInr: number;
  /** Positive: the company owes the driver. Negative: the driver returns cash. */
  balanceInr: number;
  /** Km per litre, when both km and litres are known. */
  mileage: number | null;
};

export function tripTotals(trip: TripFigures): TripTotals {
  const kmRun =
    trip.startKm != null && trip.endKm != null && trip.endKm >= trip.startKm
      ? trip.endKm - trip.startKm
      : null;
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const dieselLitres = sum(trip.diesel.map((fill) => fill.litres ?? 0));
  const dieselInr = sum(trip.diesel.map((fill) => fill.amountInr));
  const cashDieselInr = sum(
    trip.diesel.filter((fill) => fill.paidBy === "cash").map((fill) => fill.amountInr),
  );
  const cashExpensesInr = sum(trip.expenses.map((item) => item.amountInr));
  const cashSpentInr = cashExpensesInr + cashDieselInr;
  return {
    kmRun,
    dieselLitres,
    dieselInr,
    cashDieselInr,
    creditDieselInr: dieselInr - cashDieselInr,
    cashExpensesInr,
    cashSpentInr,
    balanceInr: cashSpentInr - trip.advanceInr,
    mileage: kmRun && dieselLitres > 0 ? kmRun / dieselLitres : null,
  };
}

export type TripCheck = { id: string; message: string };

const DIESEL_RATE_LOW = 75;
const DIESEL_RATE_HIGH = 120;
const MAX_KM_PER_TRIP = 3000;

/**
 * Things on the sheet that don't add up. Shown as "needs checking", never as
 * errors: the manager decides whether to fix them before approving.
 */
export function tripChecks(trip: TripFigures, usualMileage: number | null): TripCheck[] {
  const checks: TripCheck[] = [];
  const totals = tripTotals(trip);

  if (trip.writtenTotalInr != null && trip.writtenTotalInr !== totals.cashSpentInr) {
    const gap = trip.writtenTotalInr - totals.cashSpentInr;
    checks.push({
      id: "total",
      message: `The sheet total is ${formatInr(trip.writtenTotalInr)}, but the lines add up to ${formatInr(totals.cashSpentInr)}. That is ${formatInr(Math.abs(gap))} ${gap > 0 ? "short" : "extra"}. Check each amount against the photo.`,
    });
  }

  trip.diesel.forEach((fill, index) => {
    const name = `Diesel fill ${index + 1}`;
    if (!fill.litres) {
      checks.push({ id: `diesel-${index}`, message: `${name} has no litres.` });
      return;
    }
    const rate = fill.amountInr / fill.litres;
    if (rate < DIESEL_RATE_LOW || rate > DIESEL_RATE_HIGH) {
      checks.push({
        id: `diesel-${index}`,
        message: `${name}: ${formatInr(fill.amountInr)} for ${fill.litres} L is ${formatInr(Math.round(rate))} a litre. Check the litres or the amount.`,
      });
    }
  });

  if (trip.startKm != null && trip.endKm != null) {
    if (trip.endKm < trip.startKm) {
      checks.push({ id: "km", message: "The end km is less than the start km." });
    } else if (trip.endKm - trip.startKm > MAX_KM_PER_TRIP) {
      checks.push({
        id: "km",
        message: `The bus ran ${(trip.endKm - trip.startKm).toLocaleString("en-IN")} km. Check the odometer readings.`,
      });
    }
  } else {
    checks.push({ id: "km", message: "The start or end km is missing." });
  }

  if (totals.mileage != null && totals.kmRun != null && totals.kmRun <= MAX_KM_PER_TRIP) {
    const mileage = totals.mileage.toFixed(1);
    if (usualMileage != null) {
      if (totals.mileage < usualMileage * 0.85) {
        checks.push({
          id: "mileage",
          message: `Mileage is ${mileage} km/L, below this bus's usual ${usualMileage.toFixed(1)} km/L.`,
        });
      }
    } else if (totals.mileage < 2.5 || totals.mileage > 7) {
      checks.push({
        id: "mileage",
        message: `Mileage is ${mileage} km/L, which is unusual for a bus. Check the km and the litres.`,
      });
    }
  }

  if (trip.startedAt && trip.endedAt && trip.endedAt < trip.startedAt) {
    checks.push({ id: "time", message: "The trip ends before it starts." });
  }

  return checks;
}

export function settlementText(balanceInr: number): string {
  if (balanceInr > 0) {
    return `Pay the driver ${formatInr(balanceInr)}`;
  }
  if (balanceInr < 0) {
    return `Driver returns ${formatInr(-balanceInr)}`;
  }
  return "Advance fully settled";
}
