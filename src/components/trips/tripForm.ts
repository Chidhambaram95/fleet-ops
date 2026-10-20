import type { Bus } from "@domain/operations/types";
import type { TripFigures } from "@domain/trips/checks";
import type { TripInput } from "@data/trips/repository";
import type { TripSheetReading } from "@domain/trips/tripSheet";
import type { PaidBy, Trip, TripExpenseCategory } from "@domain/trips/types";

/** Form fields are strings while typing; numbers are parsed on the way out. */
export type DieselRow = { litres: string; amount: string; paidBy: PaidBy; pump: string };
export type ExpenseRow = { category: TripExpenseCategory; amount: string; note: string };

export type TripForm = {
  busId: string;
  sheetNo: string;
  route: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  haltNote: string;
  driver1: string;
  driver2: string;
  cleaner: string;
  startKm: string;
  endKm: string;
  advance: string;
  writtenTotal: string;
  diesel: DieselRow[];
  expenses: ExpenseRow[];
};

export const EMPTY_DIESEL: DieselRow = { litres: "", amount: "", paidBy: "cash", pump: "" };

export function emptyForm(busId = ""): TripForm {
  return {
    busId,
    sheetNo: "",
    route: "",
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    haltNote: "",
    driver1: "",
    driver2: "",
    cleaner: "",
    startKm: "",
    endKm: "",
    advance: "",
    writtenTotal: "",
    diesel: [{ ...EMPTY_DIESEL }],
    expenses: [
      { category: "driver_bata", amount: "", note: "" },
      { category: "cleaner_bata", amount: "", note: "" },
      { category: "toll", amount: "", note: "" },
    ],
  };
}

function text(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "" : String(value);
}

/** Reads "15,000" or " 4400 " as a number; blank stays null. */
export function parseNumber(value: string): number | null {
  const cleaned = value.replace(/[,\s₹]/g, "");
  if (!cleaned) {
    return null;
  }
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function wholeRupees(value: string) {
  const number = parseNumber(value);
  return number == null ? null : Math.round(number);
}

const IST = "Asia/Kolkata";

function istParts(iso: string | null) {
  if (!iso) {
    return { date: "", time: "" };
  }
  const when = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(when);
  return { date, time };
}

function istTimestamp(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  const clock = /^\d{2}:\d{2}$/.test(time) ? time : "00:00";
  return `${date}T${clock}:00+05:30`;
}

export function formFromTrip(trip: Trip): TripForm {
  const start = istParts(trip.startedAt);
  const end = istParts(trip.endedAt);
  return {
    busId: trip.busId,
    sheetNo: trip.sheetNo,
    route: trip.route,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    haltNote: trip.haltNote,
    driver1: trip.driver1,
    driver2: trip.driver2,
    cleaner: trip.cleaner,
    startKm: text(trip.startKm),
    endKm: text(trip.endKm),
    advance: trip.advanceInr ? String(trip.advanceInr) : "",
    writtenTotal: text(trip.writtenTotalInr),
    diesel: trip.diesel.map((fill) => ({
      litres: text(fill.litres),
      amount: String(fill.amountInr),
      paidBy: fill.paidBy,
      pump: fill.pump,
    })),
    expenses: trip.expenses.map((item) => ({
      category: item.category,
      amount: String(item.amountInr),
      note: item.note,
    })),
  };
}

function normalizeRegistration(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function validDate(value: string | null | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function validTime(value: string | null | undefined) {
  const match = value ? /^(\d{1,2}):(\d{2})$/.exec(value.trim()) : null;
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

/** Fills the form from what the photo reader saw. */
export function formFromReading(
  reading: TripSheetReading,
  buses: Bus[],
  fallbackBusId: string,
): TripForm {
  const wanted = normalizeRegistration(reading.busNumber ?? "");
  const bus = wanted
    ? buses.find((item) => normalizeRegistration(item.registrationNumber) === wanted) ??
      buses.find((item) => {
        const registration = normalizeRegistration(item.registrationNumber);
        return registration.endsWith(wanted.slice(-4)) && wanted.length >= 4;
      })
    : undefined;
  return {
    busId: bus?.id ?? fallbackBusId,
    sheetNo: reading.sheetNo?.trim() ?? "",
    route: reading.route?.trim() ?? "",
    startDate: validDate(reading.startDate),
    startTime: validTime(reading.startTime),
    endDate: validDate(reading.endDate),
    endTime: validTime(reading.endTime),
    haltNote: reading.haltNote?.trim() ?? "",
    driver1: reading.driver1?.trim() ?? "",
    driver2: reading.driver2?.trim() ?? "",
    cleaner: reading.cleaner?.trim() ?? "",
    startKm: text(reading.startKm),
    endKm: text(reading.endKm),
    advance: text(reading.advance),
    writtenTotal: text(reading.writtenTotal),
    diesel: reading.dieselFills.length
      ? reading.dieselFills.map((fill) => ({
          litres: text(fill.litres),
          amount: text(fill.amount),
          paidBy: fill.paidBy === "credit" ? "credit" : "cash",
          pump: fill.pump?.trim() ?? "",
        }))
      : [{ ...EMPTY_DIESEL }],
    expenses: reading.expenses.map((item) => ({
      category: item.category,
      amount: text(item.amount),
      note: item.note?.trim() ?? "",
    })),
  };
}

/** Lines with no amount are left out; they are blank rows on the form. */
export function figuresFromForm(form: TripForm): TripFigures {
  return {
    startKm: wholeRupees(form.startKm),
    endKm: wholeRupees(form.endKm),
    advanceInr: wholeRupees(form.advance) ?? 0,
    writtenTotalInr: wholeRupees(form.writtenTotal),
    startedAt: istTimestamp(form.startDate, form.startTime),
    endedAt: istTimestamp(form.endDate, form.endTime),
    diesel: form.diesel
      .filter((row) => (wholeRupees(row.amount) ?? 0) > 0)
      .map((row) => {
        const litres = parseNumber(row.litres);
        return {
          litres: litres && litres > 0 ? Math.round(litres * 100) / 100 : null,
          amountInr: wholeRupees(row.amount) ?? 0,
          paidBy: row.paidBy,
          pump: row.pump.trim(),
        };
      }),
    expenses: form.expenses
      .filter((row) => (wholeRupees(row.amount) ?? 0) > 0)
      .map((row) => ({
        category: row.category,
        amountInr: wholeRupees(row.amount) ?? 0,
        note: row.note.trim(),
      })),
  };
}

/** A message for the first thing that stops the trip from saving, or "". */
export function formProblem(form: TripForm): string {
  if (!form.busId) {
    return "Pick the bus.";
  }
  for (const [label, value] of [
    ["Start km", form.startKm],
    ["End km", form.endKm],
    ["Advance", form.advance],
    ["Sheet total", form.writtenTotal],
  ] as const) {
    const number = parseNumber(value);
    if (value.trim() && (number == null || number < 0)) {
      return `${label} must be a number.`;
    }
  }
  const lines = [...form.diesel, ...form.expenses];
  if (lines.some((row) => row.amount.trim() && !((parseNumber(row.amount) ?? 0) > 0))) {
    return "Every amount must be a number above 0.";
  }
  if (form.diesel.some((row) => row.litres.trim() && !((parseNumber(row.litres) ?? 0) > 0))) {
    return "Litres must be a number above 0.";
  }
  const figures = figuresFromForm(form);
  if (figures.startKm != null && figures.endKm != null && figures.endKm < figures.startKm) {
    return "The end km is less than the start km.";
  }
  if (figures.startedAt && figures.endedAt && figures.endedAt < figures.startedAt) {
    return "The trip ends before it starts.";
  }
  return "";
}

export function tripInput(form: TripForm, photoPath: string, id?: string): TripInput {
  return {
    id,
    busId: form.busId,
    sheetNo: form.sheetNo.trim(),
    route: form.route.trim(),
    haltNote: form.haltNote.trim(),
    driver1: form.driver1.trim(),
    driver2: form.driver2.trim(),
    cleaner: form.cleaner.trim(),
    photoPath,
    ...figuresFromForm(form),
  };
}
