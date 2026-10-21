import { shiftDate } from "@domain/operations/totals";
import type { TourBooking, TourPayment, TourSettings } from "./types";

const HOUR = 60 * 60 * 1000;

export function receivedTotal(bookingId: string, payments: TourPayment[]) {
  return payments
    .filter((payment) => payment.bookingId === bookingId)
    .reduce((total, payment) => total + payment.amountInr, 0);
}

/** What the customer still has to pay; never below zero. */
export function balanceDue(booking: TourBooking, payments: TourPayment[]) {
  return Math.max(booking.hireAmountInr - receivedTotal(booking.id, payments), 0);
}

/** Advance asked for in a quote: the company's percentage of the price, rounded up to ₹100. */
export function suggestedAdvance(amountInr: number, percent: number) {
  if (amountInr <= 0 || percent <= 0) return 0;
  return Math.min(amountInr, Math.ceil((amountInr * percent) / 100 / 100) * 100);
}

export function quoteValidUntil(today: string, days: number) {
  return shiftDate(today, days);
}

export function isQuoteExpired(booking: TourBooking, today: string) {
  return Boolean(booking.quoteValidUntil) && booking.quoteValidUntil! < today;
}

/** Whole days a tour covers, counting both the first and the last day. */
export function tourDays(booking: Pick<TourBooking, "startDate" | "endDate">) {
  const start = Date.parse(`${booking.startDate}T00:00:00Z`);
  const end = Date.parse(`${booking.endDate}T00:00:00Z`);
  return Math.max(Math.round((end - start) / (24 * HOUR)) + 1, 1);
}

/** When the bus is out. Without exact times the booking holds the whole days, in IST. */
function window(booking: TourBooking) {
  if (booking.startAt && booking.endAt) {
    return { from: Date.parse(booking.startAt), to: Date.parse(booking.endAt), exact: true };
  }
  return {
    from: Date.parse(`${booking.startDate}T00:00:00+05:30`),
    to: Date.parse(`${booking.endDate}T23:59:59+05:30`),
    exact: false,
  };
}

export type Clash =
  | { kind: "none" }
  | { kind: "block"; other: TourBooking }
  | { kind: "warn"; other: TourBooking; reason: "whole_day" | "short_gap" };

/**
 * How a booking sits against the bus's other confirmed bookings.
 * A real overlap of exact times is blocked. A same-day turnaround is fine when the
 * gap is at least the company's turnaround time; a shorter gap, or a booking
 * without exact times, is a warning.
 */
export function clashFor(
  booking: TourBooking,
  others: TourBooking[],
  settings: Pick<TourSettings, "turnaroundHours">,
): Clash {
  const mine = window(booking);
  let warning: Clash = { kind: "none" };
  for (const other of others) {
    if (other.id === booking.id || other.status !== "confirmed" || other.busId !== booking.busId) continue;
    const theirs = window(other);
    const overlap = mine.from < theirs.to && theirs.from < mine.to;
    if (overlap) {
      if (mine.exact && theirs.exact) return { kind: "block", other };
      warning = { kind: "warn", other, reason: "whole_day" };
      continue;
    }
    const gap = mine.from >= theirs.to ? mine.from - theirs.to : theirs.from - mine.to;
    if (mine.exact && theirs.exact && gap < settings.turnaroundHours * HOUR && warning.kind === "none") {
      warning = { kind: "warn", other, reason: "short_gap" };
    }
  }
  return warning;
}

/** Customer phone as digits for wa.me: ten digits get the India code. */
export function whatsappDigits(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

/** A tour is running when today falls between its first and last day. */
export function isRunning(booking: TourBooking, today: string) {
  return booking.status === "confirmed" && booking.startDate <= today && booking.endDate >= today;
}

export function isUpcoming(booking: TourBooking, today: string) {
  return booking.status === "confirmed" && booking.startDate > today;
}
