import { companyExpenseLabel } from "@domain/money/catalog";
import type {
  CompanyExpense,
  CrewPerson,
  IntercityIncome,
  SalaryPayment,
} from "@domain/money/types";
import { costShares } from "@domain/modules/modules";
import { categoryLabel } from "@domain/operations/catalog";
import { shiftDate } from "@domain/operations/totals";
import type { Bus, BusKind, DailyEntry } from "@domain/operations/types";
import { currentRenewals, daysLeft, dueText, renewalLabel } from "@domain/renewals/catalog";
import type { Renewal } from "@domain/renewals/types";
import { tripExpenseLabel } from "@domain/trips/catalog";
import { tripTotals } from "@domain/trips/checks";
import type { Trip } from "@domain/trips/types";
import { balanceDue, receivedTotal } from "@domain/tours/calc";
import { tripLine } from "@domain/tours/messages";
import type { TourBooking, TourPayment } from "@domain/tours/types";
import { EVENT_LABELS, positionLabel } from "@domain/tyres/catalog";
import type { Tyre, TyreClaim, TyreEvent, TyreScrapSale } from "@domain/tyres/types";

export type ReportKind = "pnl" | "bus_profit" | "trips" | "fuel" | "expenses" | "crew" | "renewals" | "tours" | "dues" | "tyres";

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
  tyres: Tyre[];
  /** Tyre moves in the date range; charge_inr is what each bus paid that day. */
  tyreEvents: TyreEvent[];
  /** Tyres sold as scrap in the date range: company income. */
  scrapSales: TyreScrapSale[];
  /** Warranty credits settled in the date range: money back to the bus that paid. */
  warrantyCredits: TyreClaim[];
  /** Odometer readings in the date range: km for buses without trip sheets. */
  odometers: { busId: string; date: string; km: number }[];
  /**
   * Days run by every bus of the company, from the database (migration 0025).
   * A manager limited to one module can't read other buses' entries, so this
   * keeps their shares the same as the admin's. Null: work it out from entries.
   */
  companyBusDays: { busId: string; busType: BusKind; days: number }[] | null;
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
  summary: {
    label: string;
    value: number;
    tone?: "in" | "out";
    /** "bracket" shows (₹1,000); "rate" shows ₹ with paise. */
    format?: "bracket" | "rate";
    /** Small text after the figure. */
    detail?: string;
  }[];
  notes: string[];
  /** Money columns shown in brackets: a figure before company costs. */
  bracketColumns?: number[];
  /** Money columns shown green when positive and red when negative. */
  toneColumns?: number[];
  /** Rupee columns with paise, such as profit per km. */
  rateColumns?: number[];
  /** Rows (by index) that are not buses, such as "Other buses". */
  extraRows?: number[];
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

/** The buses a company cost is shared by, from its "Applies to". */
export function costTargets(cost: CompanyExpense, buses: readonly Pick<Bus, "id" | "busType">[]): string[] {
  if (cost.appliesTo === "buses" && cost.busIds.length) return cost.busIds;
  if (cost.appliesTo === "type") return buses.filter((bus) => bus.busType === cost.appliesType).map((bus) => bus.id);
  return buses.map((bus) => bus.id);
}

/**
 * Each bus's part of the bank and company costs in the range, split equally
 * by the buses each cost applies to (every bus when it applies to none left).
 */
function costSharesByBus(data: ReportData, filters: ReportFilters) {
  const byBus = new Map<string, number>();
  for (const cost of data.companyExpenses) {
    if (!inRange(cost.spentOn, filters)) continue;
    for (const [busId, share] of costShares(cost.amountInr, costTargets(cost, data.buses), data.allBusIds)) {
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

/** Tyre money charged to each bus in the range: purchases, retreads and repairs. */
function tyreChargesByBus(data: ReportData, filters: ReportFilters) {
  const byBus = new Map<string, number>();
  for (const event of data.tyreEvents) {
    if (!event.busId || !event.chargeInr || !inRange(event.eventDate, filters)) continue;
    byBus.set(event.busId, (byBus.get(event.busId) ?? 0) + event.chargeInr);
  }
  for (const credit of creditsInRange(data, filters)) {
    byBus.set(credit.creditBusId!, (byBus.get(credit.creditBusId!) ?? 0) - (credit.creditInr ?? 0));
  }
  return byBus;
}

function creditsInRange(data: ReportData, filters: ReportFilters) {
  return data.warrantyCredits.filter(
    (claim) => claim.creditBusId && claim.creditInr && claim.closedOn && inRange(claim.closedOn, filters),
  );
}

function scrapInRange(data: ReportData, filters: ReportFilters) {
  return sum(data.scrapSales.filter((sale) => inRange(sale.soldOn, filters)).map((sale) => sale.amountInr));
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
  const tyreCosts = tyreChargesByBus(data, filters);

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
    const tyreOut = tyreCosts.get(bus.id) ?? 0;
    const income = ledgerIn + intercity;
    const expense = ledgerOut + tripOut + bankOut + tyreOut;
    return [bus.registrationNumber, ledgerIn, intercity, ledgerOut, tripOut, bankOut, tyreOut, income - expense];
  });

  const notes: string[] = [];
  if (wholeCompany(filters)) {
    const salaries = salariesInRange(data, filters);
    rows.push(["Crew salaries", 0, 0, 0, 0, salaries, 0, -salaries]);
    const scrap = scrapInRange(data, filters);
    if (scrap) rows.push(["Tyre scrap sold", 0, scrap, 0, 0, 0, 0, scrap]);
  } else {
    notes.push("Salaries and tyre scrap sales are left out when one bus is picked.");
  }
  notes.push("Bank and company costs are shared equally by the buses they apply to (all buses, one bus type, or the buses picked). Profit by bus splits them by days run instead.");
  notes.push("Trip costs are approved trip sheets only: all diesel (cash and credit) plus cash expenses.");
  notes.push("Intercity money is shared equally across the buses it covers. Tour payments count on the day they were received, for the bus on the booking.");
  notes.push("Tyres: a tyre's price is charged to the first bus it is fitted on, and each retread bill to the next bus it goes on, on the day it is fitted. Repairs go to the bus the tyre is on. A warranty credit is taken off the bus that paid for the tyre.");

  const total: Cell[] = ["Total", ...[1, 2, 3, 4, 5, 6, 7].map((column) => sum(rows.map((row) => Number(row[column]))))];
  const income = Number(total[1]) + Number(total[2]);
  const expense = Number(total[3]) + Number(total[4]) + Number(total[5]) + Number(total[6]);
  return {
    title: "Profit and loss",
    columns: ["Bus", "Ledger income", "Intercity, tour & scrap", "Ledger costs", "Trip costs", "Bank costs", "Tyres", "Profit"],
    moneyColumns: [1, 2, 3, 4, 5, 6, 7],
    shareColumns: [0, 7],
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
    for (const [busId, amount] of costShares(item.amountInr, costTargets(item, data.buses), data.allBusIds)) {
      if (busIds.has(busId)) share += amount;
    }
    if (share) add(companyExpenseLabel(item.category), "Bank & company", share);
  }
  for (const event of data.tyreEvents) {
    if (event.busId && event.chargeInr && busIds.has(event.busId) && inRange(event.eventDate, filters)) {
      add(event.kind === "repair" ? "Tyre repairs" : "Tyres and retreads", "Tyres", event.chargeInr);
    }
  }
  for (const credit of creditsInRange(data, filters)) {
    if (busIds.has(credit.creditBusId!)) add("Tyre warranty credits", "Tyres", -(credit.creditInr ?? 0));
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

/**
 * Tyre cost per bus: what each bus was charged in the range, and the km its
 * tyres ran on it, with every charge listed underneath.
 */
export function tyresReport(data: ReportData, filters: ReportFilters): ReportTable {
  const buses = selectedBuses(data, filters);
  const busIds = new Set(buses.map((bus) => bus.id));
  const events = data.tyreEvents.filter(
    (event) => event.busId && busIds.has(event.busId) && inRange(event.eventDate, filters),
  );
  const tyreNumber = (id: string) => data.tyres.find((tyre) => tyre.id === id)?.tyreNumber ?? "Tyre";
  const rows: Cell[][] = [];
  for (const bus of buses) {
    const theirs = events.filter((event) => event.busId === bus.id);
    const charged = sum(theirs.map((event) => event.chargeInr));
    const km = sum(theirs.map((event) => event.kmRun ?? 0));
    const fitted = theirs.filter((event) => event.kind === "fitted").length;
    const removed = theirs.filter((event) => event.kind === "removed").length;
    const credits = creditsInRange(data, filters).filter((claim) => claim.creditBusId === bus.id);
    const credited = sum(credits.map((claim) => claim.creditInr ?? 0));
    if (!charged && !km && !fitted && !removed && !credited) continue;
    rows.push([bus.registrationNumber, "", fitted, removed, km, charged - credited]);
    for (const event of theirs.filter((item) => item.chargeInr)) {
      rows.push([
        `  ${event.eventDate}`,
        `${tyreNumber(event.tyreId)} · ${EVENT_LABELS[event.kind]}${event.position ? ` · ${positionLabel(event.position)}` : ""}`,
        "",
        "",
        "",
        event.chargeInr,
      ]);
    }
    for (const claim of credits) {
      rows.push([`  ${claim.closedOn}`, `${tyreNumber(claim.tyreId)} · Warranty credit`, "", "", "", -(claim.creditInr ?? 0)]);
    }
  }
  const busRows = rows.filter((row) => row[1] === "");
  const charged = sum(busRows.map((row) => Number(row[5])));
  const km = sum(busRows.map((row) => Number(row[4])));
  return {
    title: "Tyre cost per bus",
    columns: ["Bus", "Tyre", "Fitted", "Removed", "Km run", "Charged"],
    moneyColumns: [5],
    shareColumns: [0, 1, 5],
    rows,
    total: ["Total", "", sum(busRows.map((row) => Number(row[2]))), sum(busRows.map((row) => Number(row[3]))), km, charged],
    summary: [
      { label: "Tyre cost", value: charged, tone: "out" },
      { label: "Km run", value: km },
      { label: "Tyres in use", value: data.tyres.filter((tyre) => tyre.status === "fitted" && busIds.has(tyre.currentBusId ?? "")).length },
      ...(wholeCompany(filters) && scrapInRange(data, filters)
        ? [{ label: "Scrap sold (company income)", value: scrapInRange(data, filters), tone: "in" as const }]
        : []),
    ],
    notes: [
      "A tyre's price is charged to the first bus it is fitted on, and each retread bill to the next bus it goes on. Repairs go to the bus the tyre is on.",
      "Km run counts tyres taken off or moved in these dates; tyres still running are counted when they come off.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Profit by bus: each bus's own profit, its share of company costs, and both
// ---------------------------------------------------------------------------

/** Days in the range each bus ran: a day with an approved trip on the road, or a ledger entry. */
export function daysRunByBus(data: ReportData, filters: ReportFilters): Map<string, number> {
  if (data.companyBusDays) {
    return new Map(data.companyBusDays.filter((item) => item.days > 0).map((item) => [item.busId, item.days]));
  }
  const days = new Map<string, Set<string>>();
  const add = (busId: string, day: string) => {
    if (!day || day < filters.from || day > filters.to) return;
    const set = days.get(busId) ?? new Set<string>();
    set.add(day);
    days.set(busId, set);
  };
  for (const entry of data.entries) add(entry.busId, entry.date);
  for (const trip of data.trips) {
    if (trip.status !== "approved") continue;
    const start = istDay(trip.startedAt);
    if (!start) continue;
    const end = istDay(trip.endedAt) || start;
    let day = start < filters.from ? filters.from : start;
    const last = end > filters.to ? filters.to : end;
    // A trip sheet is a few days at most; the cap guards against a mistyped end date.
    for (let guard = 0; day <= last && guard < 400; guard += 1) {
      add(trip.busId, day);
      day = shiftDate(day, 1);
    }
  }
  return new Map([...days].map(([busId, set]) => [busId, set.size]));
}

/**
 * Splits whole rupees in proportion to the weights. Leftover rupees go to the
 * largest remainders (then list order), so the parts always add up.
 */
export function splitByWeight(amountInr: number, weights: readonly (readonly [string, number])[]): Map<string, number> {
  const parts = new Map<string, number>();
  const used = weights.filter(([, weight]) => weight > 0);
  const total = sum(used.map(([, weight]) => weight));
  if (!total) return parts;
  const exact = used.map(([id, weight], index) => ({ id, index, value: (amountInr * weight) / total }));
  for (const item of exact) parts.set(item.id, (parts.get(item.id) ?? 0) + Math.floor(item.value));
  let left = amountInr - sum(exact.map((item) => Math.floor(item.value)));
  const order = [...exact].sort(
    (a, b) => b.value - Math.floor(b.value) - (a.value - Math.floor(a.value)) || a.index - b.index,
  );
  for (const item of order) {
    if (left <= 0) break;
    parts.set(item.id, (parts.get(item.id) ?? 0) + 1);
    left -= 1;
  }
  return parts;
}

/**
 * Company costs and salaries paid in the range, shared among the buses each
 * applies to, weighted by days run. A bus that didn't run takes no share; a
 * cost none of its buses ran for is left as "not shared".
 */
export function sharedCostsByBus(data: ReportData, filters: ReportFilters, days: Map<string, number>) {
  const byBus = new Map<string, number>();
  let unshared = 0;
  const share = (amountInr: number, targets: string[]) => {
    const parts = splitByWeight(
      amountInr,
      targets.map((id) => [id, days.get(id) ?? 0] as const),
    );
    if (parts.size === 0) {
      unshared += amountInr;
      return;
    }
    for (const [busId, part] of parts) byBus.set(busId, (byBus.get(busId) ?? 0) + part);
  };
  // Every bus of the company, even ones this login can't see.
  const fleet = data.companyBusDays?.map((item) => ({ id: item.busId, busType: item.busType })) ?? data.buses;
  for (const cost of data.companyExpenses) {
    if (inRange(cost.spentOn, filters)) share(cost.amountInr, costTargets(cost, fleet));
  }
  // Salaries aren't entered against a bus: each is shared by the buses of the person's type.
  for (const salary of data.salaries) {
    if (!inRange(salary.paidOn, filters)) continue;
    const person = data.people.find((item) => item.id === salary.personId);
    const targets = fleet.filter((bus) => !person || bus.busType === person.module).map((bus) => bus.id);
    share(salary.amountInr, targets);
  }
  return { byBus, unshared };
}

export type BusProfitLine = {
  bus: Bus;
  moneyIn: number;
  ownCosts: number;
  /** Money in minus own costs, before company costs. */
  busProfit: number;
  /** This bus's share of company costs and salaries. */
  shared: number;
  /** Bus profit minus its share. */
  profit: number;
  km: number;
  daysRun: number;
};

/**
 * Every bus's figures for the date range (the bus and type filters are not
 * applied, so shares are the same whatever is picked), plus the company
 * money that falls on no bus.
 */
export function busProfitLines(data: ReportData, filters: ReportFilters) {
  const all = new Set(data.buses.map((bus) => bus.id));
  const days = daysRunByBus(data, filters);
  const { byBus, unshared } = sharedCostsByBus(data, filters, days);
  const income = intercityShares(data, filters);
  const tyres = tyreChargesByBus(data, filters);
  const trips = tripsInRange(data, filters, all);
  const entries = data.entries.filter((entry) => inRange(entry.date, filters));
  const lines: BusProfitLine[] = data.buses.map((bus) => {
    const busEntries = entries.filter((entry) => entry.busId === bus.id);
    const busTrips = trips.filter((trip) => trip.busId === bus.id);
    const moneyIn =
      sum(busEntries.filter((entry) => entry.kind === "income").map((entry) => entry.amountInr)) +
      (income.get(bus.id) ?? 0);
    const ownCosts =
      sum(busEntries.filter((entry) => entry.kind === "expense").map((entry) => entry.amountInr)) +
      sum(
        busTrips.map((trip) => {
          const totals = tripTotals(trip);
          return totals.dieselInr + totals.cashExpensesInr;
        }),
      ) +
      (tyres.get(bus.id) ?? 0);
    const tripKm = sum(busTrips.map((trip) => tripTotals(trip).kmRun ?? 0));
    const readings = data.odometers.filter((item) => item.busId === bus.id).map((item) => item.km);
    const km = tripKm || (readings.length > 1 ? Math.max(...readings) - Math.min(...readings) : 0);
    const shared = byBus.get(bus.id) ?? 0;
    return {
      bus,
      moneyIn,
      ownCosts,
      busProfit: moneyIn - ownCosts,
      shared,
      profit: moneyIn - ownCosts - shared,
      km,
      daysRun: days.get(bus.id) ?? 0,
    };
  });
  return { lines, unshared, scrap: scrapInRange(data, filters) };
}

const idle = (line: BusProfitLine) => !line.daysRun && !line.moneyIn && !line.ownCosts && !line.shared;

/** Most profitable first, after shared costs; buses with nothing in the range go last. */
function byProfit(left: BusProfitLine, right: BusProfitLine) {
  return (
    Number(idle(left)) - Number(idle(right)) ||
    right.profit - left.profit ||
    left.bus.registrationNumber.localeCompare(right.bus.registrationNumber)
  );
}

/** Best and worst bus of the given buses, by profit after shared costs. */
export function bestAndWorst(lines: readonly BusProfitLine[]) {
  const ran = lines.filter((line) => !idle(line)).sort(byProfit);
  if (ran.length === 0) return null;
  return { best: ran[0], worst: ran.length > 1 ? ran[ran.length - 1] : null };
}

const perKm = (profit: number, km: number) => (km > 0 ? Math.round((profit / km) * 100) / 100 : "");

export function busProfitReport(data: ReportData, filters: ReportFilters): ReportTable {
  const { lines, unshared, scrap } = busProfitLines(data, filters);
  const picked = new Set(selectedBuses(data, filters).map((bus) => bus.id));
  const shown = lines.filter((line) => picked.has(line.bus.id)).sort(byProfit);
  const others = lines.filter((line) => !picked.has(line.bus.id));
  const rows: Cell[][] = shown.map((line, index) => [
    index + 1,
    line.bus.registrationNumber,
    BUS_TYPE_LABELS[line.bus.busType],
    line.moneyIn,
    line.ownCosts,
    line.busProfit,
    -line.shared,
    line.profit,
    line.km,
    perKm(line.profit, line.km),
    line.daysRun,
  ]);
  const extraRows: number[] = [];
  const extra = (row: Cell[]) => {
    extraRows.push(rows.length);
    rows.push(row);
  };
  // Filtered to some buses: the rest of the company, so the total is still the company's profit.
  if (others.length) {
    const otherTypes = [...new Set(others.map((line) => BUS_TYPE_LABELS[line.bus.busType]))].join(", ");
    const t = (pick: (line: BusProfitLine) => number) => sum(others.map(pick));
    extra([
      "",
      filters.busId ? "Other buses" : `Other types (${otherTypes})`,
      `${others.length} bus${others.length === 1 ? "" : "es"}`,
      t((line) => line.moneyIn),
      t((line) => line.ownCosts),
      t((line) => line.busProfit),
      -t((line) => line.shared),
      t((line) => line.profit),
      t((line) => line.km),
      perKm(t((line) => line.profit), t((line) => line.km)),
      t((line) => line.daysRun),
    ]);
  }
  if (unshared) extra(["", "Company costs no bus ran for", "", 0, 0, 0, -unshared, -unshared, "", "", ""]);
  if (scrap) extra(["", "Tyre scrap sold", "", scrap, 0, scrap, 0, scrap, "", "", ""]);

  const column = (index: number) => sum(rows.map((row) => Number(row[index]) || 0));
  const total: Cell[] = [
    "",
    extraRows.length ? "Company total" : `Total · ${shown.length} bus${shown.length === 1 ? "" : "es"}`,
    "",
    column(3),
    column(4),
    column(5),
    column(6),
    column(7),
    column(8),
    perKm(column(7), column(8)),
    "",
  ];
  const own = (pick: (line: BusProfitLine) => number) => sum(shown.map(pick));
  const km = own((line) => line.km);
  const profit = own((line) => line.profit);
  const notes = [
    "Bus profit = the bus's money in minus its own costs (ledger, trip sheets, tyres), before company costs. Shown in brackets.",
    "Share of company costs: each bank or company cost, and each salary, is split among the buses it applies to by days run in these dates. A day counts if the bus had an approved trip or a ledger entry. A bus that didn't run takes no share; a cost for one bus goes to that bus.",
    "Salaries are shared by the buses of the person's type. Intercity money is split equally across its buses; tour payments go to the bus on the booking.",
  ];
  if (extraRows.length) {
    notes.push("The company total includes other buses, costs no bus ran for and tyre scrap, so it matches the company's profit in Profit & loss.");
  }
  return {
    title: "Profit by bus",
    columns: [
      "#",
      "Bus",
      "Type",
      "Money in",
      "Own costs",
      "Bus profit (no company costs)",
      "Share of company costs",
      "Profit after shared costs",
      "Km",
      "Profit / km",
      "Days run",
    ],
    moneyColumns: [3, 4, 5, 6, 7],
    bracketColumns: [5],
    toneColumns: [6, 7],
    rateColumns: [9],
    shareColumns: [1, 5, 6, 7],
    rows,
    total,
    extraRows,
    summary: [
      { label: "Bus profit (no company costs)", value: own((line) => line.busProfit), format: "bracket" },
      { label: "Company costs shared", value: -own((line) => line.shared), tone: "out" },
      { label: "Profit after shared costs", value: profit, tone: profit >= 0 ? "in" : "out" },
      {
        label: "Profit per km",
        value: km > 0 ? Number(perKm(profit, km)) : 0,
        format: "rate",
        detail: `${km.toLocaleString("en-IN")} km`,
      },
    ],
    notes,
  };
}

export function buildReport(kind: ReportKind, data: ReportData, filters: ReportFilters, today: string): ReportTable {
  switch (kind) {
    case "pnl":
      return pnlReport(data, filters);
    case "bus_profit":
      return busProfitReport(data, filters);
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
    case "tyres":
      return tyresReport(data, filters);
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
