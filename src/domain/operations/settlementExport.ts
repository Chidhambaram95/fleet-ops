import { categoryLabel } from "./catalog";
import type { Bus, DailyEntry, EntryKind } from "./types";
import { displayDate, formatInr, totalsForEntries } from "./totals";

const CSV_HEADERS = [
  "Date",
  "Bus Name",
  "Route",
  "Type",
  "Category",
  "Amount (INR)",
  "Note",
] as const;

export function settlementFilename(date: string): string {
  return `Palaniappa_Settlement_${date}.csv`;
}

export function whatsAppSendUrl(input: {
  text: string;
  phone: string;
  userAgent: string;
}): string {
  const number = input.phone.trim();
  const encodedText = encodeURIComponent(input.text);
  if (isMobileUserAgent(input.userAgent)) {
    return `https://wa.me/${number}?text=${encodedText}`;
  }
  return `https://web.whatsapp.com/send?phone=${number}&text=${encodedText}`;
}

function isMobileUserAgent(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}

export function settlementCsv(input: {
  buses: Bus[];
  entries: DailyEntry[];
}): string {
  const rows = [
    [...CSV_HEADERS],
    ...input.entries.map((entry) => {
      const bus = input.buses.find((item) => item.id === entry.busId);
      return [
        entry.date,
        bus?.registrationNumber ?? "Unknown bus",
        bus?.routeLabel ?? "",
        entry.kind === "income" ? "Income" : "Expense",
        categoryLabel(entry.kind, entry.category),
        String(entry.amountInr),
        entry.note,
      ];
    }),
  ];

  const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  return `\uFEFF${body}`;
}

export function formatWhatsAppSettlement(input: {
  date: string;
  buses: Bus[];
  entries: DailyEntry[];
}): string {
  const totals = totalsForEntries(input.entries);
  const lines = [
    "🚌 Palaniappa Settlement",
    `📅 ${displayDate(input.date)}`,
    "",
    `💰 Total Income: ${formatInr(totals.incomeInr)}`,
    `⛽ Total Expense: ${formatInr(totals.expenseInr)}`,
    `📈 Net Profit: ${formatInr(totals.netInr)}`,
  ];

  const seen = new Set<string>();
  const busIds = [
    ...input.buses.map((bus) => bus.id),
    ...input.entries.map((entry) => entry.busId),
  ].filter((id) => {
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });

  for (const busId of busIds) {
    const busEntries = input.entries.filter((entry) => entry.busId === busId);
    if (busEntries.length === 0) {
      continue;
    }

    const bus = input.buses.find((item) => item.id === busId);
    const busTotals = totalsForEntries(busEntries);
    const name = bus?.registrationNumber ?? "Unknown bus";
    const route = bus?.routeLabel ? ` · ${bus.routeLabel}` : "";

    lines.push(
      "",
      `🚌 ${name}${route}`,
      `💰 Income: ${formatInr(busTotals.incomeInr)}`,
      `⛽ Expense: ${formatInr(busTotals.expenseInr)}`,
      `📈 Net: ${formatInr(busTotals.netInr)}`,
    );

    for (const entry of busEntries) {
      const sign = entry.kind === "income" ? "+" : "−";
      const note = entry.note ? ` · ${entry.note}` : "";
      lines.push(
        `${categoryEmoji(entry.kind, entry.category)} ${categoryLabel(entry.kind, entry.category)} ${sign}${formatInr(entry.amountInr)}${note}`,
      );
    }
  }

  if (input.entries.length === 0) {
    lines.push("", "No entries logged for this day.");
  }

  return lines.join("\n");
}

function categoryEmoji(kind: EntryKind, category: string): string {
  if (kind === "income") {
    switch (category) {
      case "ticket_collection":
        return "🎫";
      case "private_hire":
        return "🚐";
      case "parcel":
        return "📦";
      default:
        return "💵";
    }
  }

  switch (category) {
    case "diesel":
      return "⛽";
    case "toll":
      return "🛣️";
    case "crew_bata":
      return "👷";
    case "parking":
      return "🅿️";
    case "repair":
      return "🔧";
    default:
      return "💸";
  }
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
