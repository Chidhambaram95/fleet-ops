import { formatInr } from "@domain/operations/totals";
import { tourDays } from "./calc";
import type { TourBooking } from "./types";

const DAY = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const TIME = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });

export function longDay(date: string) {
  return DAY.format(new Date(`${date}T12:00:00+05:30`));
}

/** "12 Oct 2026, 6:00 am" when the exact time is known, else just the day. */
export function dayAndTime(date: string, at: string | null) {
  return at ? `${longDay(date)}, ${TIME.format(new Date(at)).toLowerCase()}` : longDay(date);
}

export function tripLine(booking: Pick<TourBooking, "pickup" | "dropPlace">) {
  return [booking.pickup, booking.dropPlace].filter(Boolean).join(" to ") || "Tour";
}

export function whenLine(booking: TourBooking) {
  const days = tourDays(booking);
  const start = dayAndTime(booking.startDate, booking.startAt);
  const end = dayAndTime(booking.endDate, booking.endAt);
  return start === end ? start : `${start} to ${end} (${days} day${days === 1 ? "" : "s"})`;
}

export function quoteNumber(booking: Pick<TourBooking, "quoteNo">) {
  return `Q-${booking.quoteNo}`;
}

/** Short list of what the price covers; one item per line or comma. */
export function inclusionItems(text: string) {
  return text
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function quoteMessage(company: string, booking: TourBooking, phone: string) {
  const lines = [
    `*${company}*`,
    `Quote ${quoteNumber(booking)} for ${booking.customerName}`,
    "",
    `🚌 ${tripLine(booking)}`,
    `🗓️ ${whenLine(booking)}`,
    booking.seatsNeeded ? `👥 ${booking.seatsNeeded} people` : "",
    "",
    `Total price: *${formatInr(booking.hireAmountInr)}*`,
  ];
  if (booking.advanceRequiredInr) lines.push(`To book, pay ${formatInr(booking.advanceRequiredInr)} in advance.`);
  const items = inclusionItems(booking.inclusions);
  if (items.length) lines.push(`Includes: ${items.join(", ")}`);
  if (booking.quoteValidUntil) lines.push(`Price valid till ${longDay(booking.quoteValidUntil)}.`);
  if (phone) lines.push("", `Call or WhatsApp us on ${phone} to book.`);
  return lines.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");
}

export function confirmationMessage(company: string, booking: TourBooking, bus: string, received: number, balance: number) {
  const lines = [
    `*${company}*`,
    `Hello ${booking.customerName}, your booking is confirmed. ✅`,
    "",
    `🚌 ${bus} · ${tripLine(booking)}`,
    `🗓️ ${whenLine(booking)}`,
    "",
    `Total price: ${formatInr(booking.hireAmountInr)}`,
    `Paid so far: ${formatInr(received)}`,
  ];
  if (balance > 0) lines.push(`Balance to pay: *${formatInr(balance)}*`);
  lines.push("", "Thank you for choosing us!");
  return lines.join("\n");
}

export function reminderMessage(company: string, booking: TourBooking, balance: number) {
  return [
    `*${company}*`,
    `Hello ${booking.customerName}, a small reminder for your tour (${tripLine(booking)}, ${longDay(booking.startDate)}).`,
    `Balance to pay: *${formatInr(balance)}*`,
    "Please pay by UPI, bank or cash. Thank you!",
  ].join("\n");
}
