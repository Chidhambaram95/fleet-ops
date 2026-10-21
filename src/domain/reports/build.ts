import { companyExpenseLabel } from "@domain/money/catalog";
import type {
  CompanyExpense,
  CrewPerson,
  IntercityIncome,
  SalaryPayment,
} from "@domain/money/types";
import { costShares } from "@domain/modules/modules";
import { categoryLabel } from "@domain/operations/catalog";
import type { Bus, BusKind, DailyEntry } from "@domain/operations/types";
import { currentRenewals, daysLeft, dueText, renewalLabel } from "@domain/renewals/catalog";
import type { Renewal } from "@domain/renewals/types";
import { tripExpenseLabel } from "@domain/trips/catalog";
import { tripTotals } from "@domain/trips/checks";
import type { Trip } from "@domain/trips/types";
import { balanceDue, receivedTotal } from "@domain/tours/calc";
import { tripLine } from "@domain/tours/messages";
import type { TourBooking, TourPayment } from "@domain/tours/types";

export type ReportKind = "pnl" | "trips" | "fuel" | "expenses" | "crew" | "renewals" | "tours" | "dues";

export type ReportFilters = {
  from: string;
  to: string;
  /** Empty for all buses. */
  busId: string;
  /** Empty for every type. */
  busType: "" | BusKind;
  /** Renewals report only: how many days ahead. */
  renewalDays: 30 | 60 | 90;
};

export type ReportData = {
  buses: Bus[];
  /** Every bus of the company, which shares a cost with no buses picked. */
  allBusIds: string[];
  people: CrewPerson[];
  entries: DailyEntry[];
  trips: Trip[];
  companyExpenses: CompanyExpense[];
  salaries: SalaryPayment[];
  intercity: IntercityIncome[];
  renewals: Renewal[];
  tourBookings: TourBooking[];
  tourPayments: TourPayment[];
};

export type Cell = string | number;

/** Every report is one table, so the screen, CSV, print and WhatsApp share it. */
export type ReportTable = {
  title: string;
  columns: string[];
  /** Columns holding rupees, formatted as money on screen and in WhatsApp. */
  moneyColumns: number[];
  /** The few columns that fit on one WhatsApp line. */
  shareColumns: number[];
  rows: Cell[][];
  total?: Cell[];
  /** Headline figures shown above the table. */
  summary: { label: string; value: number; tone?: "in" | "out" }[];
  notes: string[];
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const inRange = (date: string | null | undefined, filters: ReportFilters) =>
  !!date && date.slice(0, 10) >= filters.from && date.slice(0, 10) <= filters.to;
/** IST calendar day of an ISO timestamp. */
export function istDay(timestamp: string | null): string {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export const BUS_TYPE_LABELS: Record<BusKind, string> = {
  town: "Town",
  omni: "Omni",
  tour: "Tour",
};

function selectedBuses(data: ReportData, filters: ReportFilters): Bus[] {
  return data.buses.filter(
    (bus) =>
      (!filters.busId || bus.id === filters.busId) &&
      (!filters.busType || bus.busType === filters.busType),
  );
}

/** Salaries are not tied to a bus, so they are left out when one bus is picked. */
function wholeCompany(filters: ReportFilters) {
  return !filters.busId;
}

/** Salaries paid in the range to the crew of the picked bus type. */
function salariesInRange(data: ReportData, filters: ReportFilters) {
  if (!wholeCompany(filters)) return 0;
  return sum(
    data.salaries
      .filter((item) => inRange(item.paidOn, filters))
      .filter(
        (item) =>
          !filters.busType ||
          data.people.find((person) => person.id === item.personId)?.module === filters.busType,
      )
      .map((item) => item.amountInr),
  );
}

/**
 * Each bus's part of the bank and company costs in the range. A cost for
 * several buses is shared equally by them; one with none by every bus.
 */
function costSharesByBus(data: ReportData, filters: ReportFilters) {
  const byBus = new Map<string, number>();
  for (const cost of data.companyExpenses) {
    if (!inRange(cost.spentOn, filters)) continue;
    for (const [busId, share] of costShares(cost.amountInr, cost.busIds, data.allBusIds)) {
      byBus.set(busId, (byBus.get(busId) ?? 0) + share);
    }
  }
  return byBus;
}

function busLabel(data: ReportData, busId: string | null) {
  return busId ? (data.buses.find((bus) => bus.id === busId)?.registrationNumber ?? "Bus") : "Company";
}

/** Intercity money split equally across the buses it covers, by the day it was received. */
function intercityShares(data: ReportData, filters: ReportFilters) {
  const shares = new Map<string, number>();
  for (const payment of data.intercity) {
    if (!inRange(payment.receivedOn, filters) || payment.busIds.length === 0) continue;
    // Whole rupees; the leftover rupees go to the first buses so the total still matches.
    const base = Math.floor(payment.amountInr / payment.busIds.length);
    const leftover = payment.amountInr - base * payment.busIds.length;
    payment.busIds.forEach((busId, index) => {
      shares.set(busId, (shares.get(busId) ?? 0) + base + (index < leftover ? 1 : 0));
    });
  }
  // Tour customers' payments count as income of the bus on the booking.
  for (const payment of data.tourPayments) {
    if (!inRange(payment.receivedOn, filters)) continue;
    const busId = data.tourBookings.find((booking) => booking.id === payment.bookingId)?.busId;
    if (busId) shares.set(busId, (shares.get(busId) ?? 0) + payment.amountInr);
  }
  return shares;
}

function tripsInRange(data: ReportData, filters: ReportFilters, busIds: Set<string>) {
  return data.trips.filter(
    (trip) => trip.status === "approved" && busIds.has(trip.busId) && inRange(istDay(trip.startedAt), filters),
  );
}

export function pnlReport(data: ReportData, filters: ReportFilters): ReportTable {
  const buses = selectedBuses(data, filters);
  const busIds = new Set(buses.map((bus) => bus.id));
  const shares = intercityShares(data, filters);
  const trips = tripsInRange(data, filters, busIds);
  const entries = data.entries.filter((entry) => busIds.has(entry.busId) && inRange(entry.date, filters));
  const costs = costSharesByBus(data, filters);

  const rows: Cell[][] = buses.map((bus) => {
    const busEntries = entries.filter((entry) => entry.busId === bus.id);
    const busTrips = trips.filter((trip) => trip.busId === bus.id);
    const ledgerIn = sum(busEntries.filter((e) => e.kind === "income").map((e) => e.amountInr));
    const intercity = shares.get(bus.id) ?? 0;
    const ledgerOut = sum(busEntries.filter((e) => e.kind === "expense").map((e) => e.amountInr));
    const tripOut = sum(
      busTrips.map((trip) => {
        const totals = tripTotals(trip);
        return totals.dieselInr + totals.cashExpensesInr;
      }),
    );
    const bankOut = costs.get(bus.id) ?? 0;
    const income = ledgerIn + intercity;
    const expense = ledgerOut + tripOut + bankOut;
    return [bus.registrationNumber, ledgerIn, intercity, ledgerOut, tripOut, bankOut, income - expense];
  });

  const notes: string[] = [];
  if (wholeCompany(filters)) {
    const salaries = salariesInRange(data, filters);
    rows.push(["Crew salaries", 0, 0, 0, 0, salaries, -salaries]);
  } else {
    notes.push("Salaries are left out when one bus is picked.");
  }
  notes.push("Bank and company costs are shared equally by the buses they were for, or by every bus when none was picked.");
  notes.push("Trip costs are approved trip sheets only: all diesel (cash and credit) plus cash expenses.");
  notes.push("Intercity money is shared equally across the buses it covers. Tour payments count on the day they were received, for the bus on the booking.");

  const total: Cell[] = ["Total", ...[1, 2, 3, 4, 5, 6].map((column) => sum(rows.map((row) => Number(row[column]))))];
  const income = Number(total[1]) + Number(total[2]);
  const expense = Number(total[3]) + Number(total[4]) + Number(total[5]);
  return {
    title: "Profit and loss",
    columns: ["Bus", "Ledger income", "Intercity & tour income", "Ledger costs", "Trip costs", "Bank costs", "Profit"],
    moneyColumns: [1, 2, 3, 4, 5, 6],
    shareColumns: [0, 6],
    rows,
    total,
    summary: [
      { label: "Money in", value: income, tone: "in" },
      { label: "Money out", value: expense, tone: "out" },
      { label: income - expense >= 0 ? "Profit" : "Loss", value: income - expense, tone: income - expense >= 0 ? "in" : "out" },
    ],
    notes,
  };
}

export function tripsReport(data: ReportData, filters: ReportFilters): ReportTable {
  const busIds = new Set(selectedBuses(data, filters).map((bus) => bus.id));
  const trips = tripsInRange(data, filters, busIds).sort((a, b) =>
    (a.startedAt ?? "").localeCompare(b.startedAt ?? ""),
  );
  const rows: Cell[][] = trips.map((trip) => {
    const totals = tripTotals(trip);
    return [
      istDay(trip.startedAt),
      busLabel(data, trip.busId),
      trip.sheetNo,
      trip.route,
      trip.driver1,
      totals.kmRun ?? "",
      Math.round(totals.dieselLitres),
      totals.mileage != null ? Number(totals.mileage.toFixed(1)) : "",
      totals.dieselInr,
      totals.cashExpensesInr,
      totals.balanceInr,
    ];
  });
  const total: Cell[] = [
    "Total",
    "",
    `${rows.length} trips`,
    "",
    "",
    sum(rows.map((row) => Number(row[5]) || 0)),
    sum(rows.map((row) => Number(row[6]) || 0)),
    "",
    sum(rows.map((row) => Number(row[8]))),
    sum(rows.map((row) => Number(row[9]))),
    "",
  ];
  return {
    title: "Trips",
    columns: ["Date", "Bus", "Sheet", "Route", "Driver", "Km", "Diesel L", "Km/L", "Diesel ₹", "Cash costs", "Advance balance"],
    moneyColumns: [8, 9, 10],
    shareColumns: [0, 1, 3, 5, 7],
    rows,
    total,
    summary: [
      { label: "Trips", value: rows.length },
      { label: "Diesel", value: Number(total[8]), tone: "out" },
      { label: "Cash costs", value: Number(total[9]), tone: "out" },
    ],
    notes: ["Approved trip sheets only. A positive advance balance is owed to the driver."],
  };
}

export function fuelReport(data: ReportData, filters: ReportFilters): ReportTable {
  const buses = selectedBuses(data, filters);
  const trips = tripsInRange(data, filters, new Set(buses.map((bus) => bus.id)));
  const ledgerDiesel = data.entries.filter(
    (entry) => entry.kind === "expense" && entry.category === "diesel" && inRange(entry.date, filters),
  );
  const rows: Cell[][] = buses.map((bus) => {
    const busTrips = trips.filter((trip) => trip.busId === bus.id);
    const fills = busTrips.flatMap((trip) => trip.diesel);
    const withKm = busTrips.filter((trip) => tripTotals(trip).mileage != null);
    const km = sum(withKm.map((trip) => tripTotals(trip).kmRun ?? 0));
    const kmLitres = sum(withKm.map((trip) => tripTotals(trip).dieselLitres));
    const litres = sum(fills.map((fill) => fill.litres ?? 0));
    return [
      bus.registrationNumber,
      Math.round(litres),
      sum(fills.filter((fill) => fill.paidBy === "cash").map((fill) => fill.amountInr)),
      sum(fills.filter((fill) => fill.paidBy === "credit").map((fill) => fill.amountInr)),
      sum(ledgerDiesel.filter((entry) => entry.busId === bus.id).map((entry) => entry.amountInr)),
      km,
      kmLitres > 0 ? Number((km / kmLitres).toFixed(1)) : "",
    ];
  });
  const total: Cell[] = [
    "Total",
    ...[1, 2, 3, 4, 5].map((column) => sum(rows.map((row) => Number(row[column]) || 0))),
    "",
  ];
  return {
    title: "Fuel",
    columns: ["Bus", "Litres", "Cash diesel", "Credit diesel", "Ledger diesel", "Km", "Km/L"],
    moneyColumns: [2, 3, 4],
    shareColumns: [0, 1, 6],
    rows,
    total,
    summary: [
      { label: "Litres", value: Number(total[1]) },
      { label: "Diesel cost", value: Number(total[2]) + Number(total[3]) + Number(total[4]), tone: "out" },
    ],
    notes: ["Cash and credit diesel come from approved trip sheets; ledger diesel from the home screen."],
  };
}

export function expensesReport(data: ReportData, filters: ReportFilters): ReportTable {
  const busIds = new Set(selectedBuses(data, filters).map((bus) => bus.id));
  const totals = new Map<string, { source: string; amount: number }>();
  const add = (label: string, source: string, amount: number) => {
    const key = `${source}:${label}`;
    const found = totals.get(key) ?? { source, amount: 0 };
    found.amount += amount;
    totals.set(key, found);
  };
  for (const entry of data.entries) {
    if (entry.kind === "expense" && busIds.has(entry.busId) && inRange(entry.date, filters)) {
      add(categoryLabel("expense", entry.category), "Daily cash", entry.amountInr);
    }
  }
  for (const trip of tripsInRange(data, filters, busIds)) {
    for (const fill of trip.diesel) add(fill.paidBy === "credit" ? "Diesel (credit)" : "Diesel (cash)", "Trip sheets", fill.amountInr);
    for (const item of trip.expenses) add(tripExpenseLabel(item.category), "Trip sheets", item.amountInr);
  }
  for (const item of data.companyExpenses) {
    if (!inRange(item.spentOn, filters)) continue;
    let share = 0;
    for (const [busId, amount] of costShares(item.amountInr, item.busIds, data.allBusIds)) {
      if (busIds.has(busId)) share += amount;
    }
    if (share) add(companyExpenseLabel(item.category), "Bank & company", share);
  }
  const salaries = salariesInRange(data, filters);
  if (salaries) add("Crew salaries", "Salaries", salaries);
  const grand = sum([...totals.values()].map((item) => item.amount));
  const rows: Cell[][] = [...totals.entries()]
    .map(([key, item]): Cell[] => [
      key.slice(key.indexOf(":") + 1),
      item.source,
      item.amount,
      grand ? `${Math.round((item.amount / grand) * 100)}%` : "",
    ])
    .sort((a, b) => Number(b[2]) - Number(a[2]));
  return {
    title: "Expense breakdown",
    columns: ["What for", "From", "Amount", "Share"],
    moneyColumns: [2],
    shareColumns: [0, 2],
    rows,
    total: ["Total", "", grand, rows.length ? "100%" : ""],
    summary: [{ label: "Total spent", value: grand, tone: "out" }],
    notes: [
      "Bank and company costs count only the part that falls on these buses.",
      ...(wholeCompany(filters) ? [] : ["Salaries are left out when one bus is picked."]),
    ],
  };
}

export function crewReport(data: ReportData, filters: ReportFilters): ReportTable {
  const busIds = new Set(selectedBuses(data, filters).map((bus) => bus.id));
  const trips = tripsInRange(data, filters, busIds);
  const nameKey = (name: string) => name.trim().toLowerCase();
  const people = data.people.filter((person) => !filters.busType || person.module === filters.busType);
  const rows: Cell[][] = people.map((person) => {
    const theirs = trips.filter((trip) =>
      [trip.driver1, trip.driver2, trip.cleaner].some((name) => name && nameKey(name) === nameKey(person.name)),
    );
    const paid = sum(
      data.salaries
        .filter((item) => item.personId === person.id && inRange(item.paidOn, filters))
        .map((item) => item.amountInr),
    );
    const open = sum(
      theirs
        .filter((trip) => !trip.settledOn && nameKey(trip.driver1) === nameKey(person.name))
        .map((trip) => tripTotals(trip).balanceInr),
    );
    return [
      person.name,
      person.job === "driver" ? "Driver" : "Cleaner",
      theirs.length,
      sum(theirs.map((trip) => tripTotals(trip).kmRun ?? 0)),
      paid,
      open,
    ];
  });
  const total: Cell[] = ["Total", "", ...[2, 3, 4, 5].map((column) => sum(rows.map((row) => Number(row[column]))))];
  return {
    title: "Crew",
    columns: ["Name", "Job", "Trips", "Km", "Salary paid", "Open advance"],
    moneyColumns: [4, 5],
    shareColumns: [0, 4, 5],
    rows,
    total,
    summary: [
      { label: "Salary paid", value: Number(total[4]), tone: "out" },
      { label: "Open advances", value: Number(total[5]) },
    ],
    notes: ["Trips are matched by the name written on the trip sheet."],
  };
}

export function renewalsReport(data: ReportData, filters: ReportFilters, today: string): ReportTable {
  const busIds = new Set(selectedBuses(data, filters).map((bus) => bus.id));
  const rows: Cell[][] = currentRenewals(data.renewals)
    .filter((renewal) =>
      renewal.busId
        ? busIds.has(renewal.busId)
        : wholeCompany(filters) &&
          (!filters.busType ||
            data.people.find((person) => person.id === renewal.personId)?.module === filters.busType),
    )
    .map((renewal) => ({ renewal, days: daysLeft(renewal.expiresOn, today) }))
    .filter((item) => item.days <= filters.renewalDays)
    .map(({ renewal, days }) => [
      renewal.busId
        ? busLabel(data, renewal.busId)
        : (data.people.find((person) => person.id === renewal.personId)?.name ?? "Driver"),
      renewalLabel(renewal.kind),
      renewal.expiresOn,
      dueText(days),
      renewal.amountInr ?? "",
    ]);
  return {
    title: `Renewals due in ${filters.renewalDays} days`,
    columns: ["Bus / driver", "Document", "Expires", "Status", "Last paid ₹"],
    moneyColumns: [4],
    shareColumns: [0, 1, 2, 3],
    rows,
    summary: [
      { label: "Due", value: rows.length },
      { label: "Last year's cost", value: sum(rows.map((row) => Number(row[4]) || 0)), tone: "out" },
    ],
    notes: ["Includes anything already expired. The date range does not apply here."],
  };
}

/** Hire minus the cost of the tour's approved trip sheet. */
export function toursReport(data: ReportData, filters: ReportFilters): ReportTable {
  const buses = selectedBuses(data, filters);
  const busIds = new Set(buses.map((bus) => bus.id));
  const rows: Cell[][] = data.tourBookings
    .filter(
      (booking) =>
        (booking.status === "confirmed" || booking.status === "completed") &&
        booking.busId &&
        busIds.has(booking.busId) &&
        inRange(booking.startDate, filters),
    )
    .sort((left, right) => left.startDate.localeCompare(right.startDate))
    .map((booking) => {
      const trip = data.trips.find((item) => item.id === booking.tripId);
      const costs = trip ? tripTotals(trip).dieselInr + tripTotals(trip).cashExpensesInr : 0;
      return [
        booking.customerName,
        busLabel(data, booking.busId),
        `${booking.startDate} · ${tripLine(booking)}`,
        booking.hireAmountInr,
        trip ? costs : "Not approved",
        trip ? booking.hireAmountInr - costs : "–",
      ];
    });
  const hire = sum(rows.map((row) => Number(row[3])));
  const costs = sum(rows.map((row) => Number(row[4]) || 0));
  const profit = sum(rows.map((row) => Number(row[5]) || 0));
  return {
    title: "Profit per tour",
    columns: ["Customer", "Bus", "Tour", "Hire", "Trip costs", "Profit"],
    moneyColumns: [3, 4, 5],
    shareColumns: [0, 1, 5],
    rows,
    total: ["Total", "", "", hire, costs, profit],
    summary: [
      { label: "Hire", value: hire, tone: "in" },
      { label: "Trip costs", value: costs, tone: "out" },
      { label: profit >= 0 ? "Profit" : "Loss", value: profit, tone: profit >= 0 ? "in" : "out" },
    ],
    notes: [
      "Tours confirmed or completed that start in these dates. Trip costs come from the approved trip sheet; a tour with no approved sheet shows 'Not approved'.",
      "Bank and company costs are not shared into this report; see Profit per bus.",
    ],
  };
}

/** What each tour customer still owes; the date range does not apply. */
export function duesReport(data: ReportData, filters: ReportFilters): ReportTable {
  const buses = selectedBuses(data, filters);
  const busIds = new Set(buses.map((bus) => bus.id));
  const rows: Cell[][] = data.tourBookings
    .filter(
      (booking) =>
        (booking.status === "confirmed" || booking.status === "completed") &&
        booking.busId &&
        busIds.has(booking.busId) &&
        balanceDue(booking, data.tourPayments) > 0,
    )
    .sort((left, right) => left.startDate.localeCompare(right.startDate))
    .map((booking) => [
      booking.customerName,
      booking.customerPhone,
      `${booking.startDate} · ${tripLine(booking)}`,
      booking.hireAmountInr,
      receivedTotal(booking.id, data.tourPayments),
      balanceDue(booking, data.tourPayments),
    ]);
  const balance = sum(rows.map((row) => Number(row[5])));
  return {
    title: "Customer dues",
    columns: ["Customer", "Phone", "Tour", "Hire", "Received", "Balance"],
    moneyColumns: [3, 4, 5],
    shareColumns: [0, 2, 5],
    rows,
    total: ["Total", "", "", sum(rows.map((row) => Number(row[3]))), sum(rows.map((row) => Number(row[4]))), balance],
    summary: [{ label: "Balance to collect", value: balance, tone: "out" }],
    notes: ["Confirmed and completed tours with money still to receive. The date range does not apply here."],
  };
}

export function buildReport(kind: ReportKind, data: ReportData, filters: ReportFilters, today: string): ReportTable {
  switch (kind) {
    case "pnl":
      return pnlReport(data, filters);
    case "trips":
      return tripsReport(data, filters);
    case "fuel":
      return fuelReport(data, filters);
    case "expenses":
      return expensesReport(data, filters);
    case "crew":
      return crewReport(data, filters);
    case "renewals":
      return renewalsReport(data, filters, today);
    case "tours":
      return toursReport(data, filters);
    case "dues":
      return duesReport(data, filters);
  }
}

function csvCell(value: Cell) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV that Excel opens directly; the BOM keeps ₹ and Tamil text readable. */
export function reportCsv(table: ReportTable, filters: ReportFilters): string {
  const lines = [
    [table.title, `${filters.from} to ${filters.to}`],
    [],
    table.columns,
    ...table.rows,
    ...(table.total ? [table.total] : []),
  ];
  return `﻿${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
