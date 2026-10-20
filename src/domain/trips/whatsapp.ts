import { formatInr } from "@domain/operations/totals";
import { tripExpenseLabel } from "./catalog";
import { settlementText, tripTotals } from "./checks";
import type { Trip } from "./types";

export function tripDateTime(value: string | null): string {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Trip summary to send on WhatsApp, like the daily settlement. */
export function formatTripWhatsApp(input: {
  company: string;
  busNumber: string;
  trip: Trip;
}): string {
  const { trip } = input;
  const totals = tripTotals(trip);
  const lines = [
    `*${input.company} · Trip ${trip.sheetNo ? `#${trip.sheetNo}` : "summary"}*`,
    `🚌 ${input.busNumber}${trip.route ? ` · ${trip.route}` : ""}`,
  ];
  const when = [tripDateTime(trip.startedAt), tripDateTime(trip.endedAt)].filter(Boolean);
  if (when.length) {
    lines.push(`🗓️ ${when.join(" → ")}`);
  }
  const crew = [trip.driver1, trip.driver2, trip.cleaner].filter(Boolean);
  if (crew.length) {
    lines.push(`👷 ${crew.join(", ")}`);
  }
  if (totals.kmRun != null) {
    lines.push(
      `🛣️ ${totals.kmRun.toLocaleString("en-IN")} km${
        totals.mileage ? ` · ${totals.mileage.toFixed(1)} km/L` : ""
      }`,
    );
  }
  lines.push("");
  if (trip.diesel.length) {
    lines.push(
      `⛽ Diesel ${totals.dieselLitres.toLocaleString("en-IN")} L · ${formatInr(totals.dieselInr)}` +
        (totals.creditDieselInr ? ` (credit ${formatInr(totals.creditDieselInr)})` : ""),
    );
  }
  for (const expense of trip.expenses) {
    lines.push(`• ${tripExpenseLabel(expense.category)}: ${formatInr(expense.amountInr)}`);
  }
  lines.push("");
  lines.push(`Cash spent: ${formatInr(totals.cashSpentInr)}`);
  lines.push(`Advance: ${formatInr(trip.advanceInr)}`);
  lines.push(`*${settlementText(totals.balanceInr)}*`);
  if (trip.status !== "approved") {
    lines.push("_Not approved yet_");
  }
  return lines.join("\n");
}
