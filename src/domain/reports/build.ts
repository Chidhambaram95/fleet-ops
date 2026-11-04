import { companyExpenseLabel } from "@domain/money/catalog";
import type {
  CompanyExpense,
  CrewPerson,
  IntercityIncome,
  SalaryPayment,
} from "@domain/money/types";
import { categoryLabel } from "@domain/operations/catalog";
import { formatInr, shiftDate } from "@domain/operations/totals";
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
  /** Odometer readings in the date range and a few months before it: km and days run. */
  odometers: { busId: string; date: string; km: number }[];
  /**
   * Days run by every bus of the company, from the database (migration 0025).
   * A manager limited to one module can't read other buses' entries, so this
   * keeps their shares the same as the admin's. Null: work it out from entries.
   */
  companyBusDays: { busId: string; busType: BusKind; days: number }[] | null;
  /** Town day crew rows (who worked which bus each day), for days run and salaries. */
  dayCrew: { busId: string; date: string; personId: string }[];
  /** Days buses were marked off road (migration 0026). */
  offRoad: { busId: string; date: string }[];
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
    /** "money" shows ₹ without a colour; "rate" shows ₹ with paise; "none" shows a dash. */
    format?: "money" | "rate" | "none";
    /** Small text after the figure. */
    detail?: string;
  }[];
  notes: string[];
  /** Money columns shown green when positive and red when negative. */
  toneColumns?: number[];
  /** Rupee columns with paise, such as profit per km. */
  rateColumns?: number[];
  /** Rows (by index) that are not buses, such as "Other buses". */
  extraRows?: number[];
  /** Profit by bus only: the breakdown behind each row, by row index. */
  details?: (BusDetail | null)[];
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
  // Split the same way as Profit by bus; salaries stay one company line here.
  const shared = sharedCostsByBus(data, filters, daysRunByBus(data, filters));
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
    const parts = shared.byBus.get(bus.id);
    const bankOut = parts ? parts.fixed + parts.overhead : 0;
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
    const noBus = shared.unshared.fixed + shared.unshared.overhead;
    if (noBus && !filters.busType) rows.push(["Costs with no bus", 0, 0, 0, 0, noBus, 0, -noBus]);
  } else {
    notes.push("Salaries and tyre scrap sales are left out when one bus is picked.");
  }
  notes.push("Bank and company costs are split among the buses they apply to (all buses, one bus type, or the buses picked) equally, the same as Profit by bus. Costs paid for several months are spread day by day over those months.");
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
  const shared = sharedCostsByBus(data, filters, daysRunByBus(data, filters));
  for (const busId of busIds) {
    for (const item of shared.items.get(busId) ?? []) {
      if (item.group !== "salary") add(item.label.split(" · ")[0], "Bank & company", item.amountInr);
    }
  }
  if (!filters.busId && !filters.busType) {
    for (const item of shared.unsharedItems) {
      if (item.group !== "salary") add(item.label.split(" · ")[0], "Bank & company", item.amountInr);
    }
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
      "Bank and company costs count only the part that falls on these buses (split equally among the buses each applies to), and costs paid for several months are spread over them.",
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

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Math.round(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / DAY_MS);

/** Calendar days from `from` to `to`, both counted. */
export function rangeDays(filters: Pick<ReportFilters, "from" | "to">): number {
  return Math.max(0, dayNumber(filters.to) - dayNumber(filters.from) + 1);
}

/** First and last day a company cost is spread over: whole months from the month it was paid. */
export function spreadSpan(cost: Pick<CompanyExpense, "spentOn" | "spreadMonths">): { start: string; end: string } {
  const year = Number(cost.spentOn.slice(0, 4));
  const month = Number(cost.spentOn.slice(5, 7));
  const start = `${cost.spentOn.slice(0, 7)}-01`;
  const end = new Date(Date.UTC(year, month - 1 + (cost.spreadMonths || 1), 0)).toISOString().slice(0, 10);
  return { start, end };
}

/**
 * The part of a company cost that falls in the date range. Every cost is
 * spread day by day over its months (a ₹21,000 EMI for November counts ₹700
 * a day). Worked out from running totals, so the parts of back-to-back ranges
 * always add up to the amount paid.
 */
export function costInRange(
  cost: Pick<CompanyExpense, "spentOn" | "spreadMonths" | "amountInr">,
  filters: Pick<ReportFilters, "from" | "to">,
): number {
  if (!cost.spentOn) return 0;
  const { start, end } = spreadSpan(cost);
  const first = dayNumber(start);
  const span = dayNumber(end) - first + 1;
  const upTo = (day: number) => Math.min(Math.max(day - first + 1, 0), span);
  const through = Math.round((cost.amountInr * upTo(dayNumber(filters.to))) / span);
  const before = Math.round((cost.amountInr * upTo(dayNumber(filters.from) - 1)) / span);
  return through - before;
}

/** Ledger costs that show the bus was out on the road that day. */
const RUNNING_COSTS = new Set(["diesel", "adblue", "toll", "crew_bata", "police", "parking"]);

/**
 * Days in the range each bus ran. A day counts with an approved trip on the
 * road, money in, a running cost (diesel, AdBlue, toll, crew bata, police,
 * parking), an odometer reading higher than the one before, or Town day crew
 * on the bus. A repair or "other" bill alone doesn't count, and a day marked
 * off road never counts. The database works this out the same way
 * (company_bus_days, migration 0026).
 */
export function daysRunByBus(data: ReportData, filters: ReportFilters): Map<string, number> {
  if (data.companyBusDays) {
    return new Map(data.companyBusDays.filter((item) => item.days > 0).map((item) => [item.busId, item.days]));
  }
  const off = new Set(data.offRoad.map((item) => `${item.busId}|${item.date}`));
  const days = new Map<string, Set<string>>();
  const add = (busId: string, day: string) => {
    if (!day || day < filters.from || day > filters.to || off.has(`${busId}|${day}`)) return;
    const set = days.get(busId) ?? new Set<string>();
    set.add(day);
    days.set(busId, set);
  };
  for (const entry of data.entries) {
    if (entry.kind === "income" || RUNNING_COSTS.has(entry.category)) add(entry.busId, entry.date);
  }
  const readings = [...data.odometers].sort((a, b) => a.busId.localeCompare(b.busId) || a.date.localeCompare(b.date));
  readings.forEach((reading, index) => {
    const previous = readings[index - 1];
    if (previous && previous.busId === reading.busId && reading.km > previous.km) add(reading.busId, reading.date);
  });
  for (const row of data.dayCrew) add(row.busId, row.date);
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

/** EMIs, insurance and permits: what a bus costs just by being owned. */
const FIXED_COSTS = new Set(["loan_emi", "insurance", "permit_tax", "bank_fees"]);

export type CostGroup = "fixed" | "overhead" | "salary";

/** One company cost or salary and the part of it a bus carries. */
export type SharedItem = { id: string; label: string; date: string; group: CostGroup; amountInr: number };

export type SharedCosts = {
  /** Each bus's shared costs, by group. */
  byBus: Map<string, Record<CostGroup, number>>;
  /** Each bus's shared items, for the bus breakdown. */
  items: Map<string, SharedItem[]>;
  /** Costs with no bus to go to (a bus type with no buses), by group. */
  unshared: Record<CostGroup, number>;
  unsharedItems: SharedItem[];
};

const noGroups = (): Record<CostGroup, number> => ({ fixed: 0, overhead: 0, salary: 0 });
export const groupTotal = (groups: Record<CostGroup, number>) => groups.fixed + groups.overhead + groups.salary;

/**
 * Company costs (their part in the range) are split equally among the buses
 * each applies to, whether they ran or not: rent, EMIs and the office are paid
 * either way. Crew salaries paid in the range follow the work: the buses the
 * person worked on the Town day crew that month; with no day crew, the buses
 * of their type by days run (equally if none of them ran).
 */
export function sharedCostsByBus(data: ReportData, filters: ReportFilters, days: Map<string, number>): SharedCosts {
  const byBus = new Map<string, Record<CostGroup, number>>();
  const items = new Map<string, SharedItem[]>();
  const unshared = noGroups();
  const unsharedItems: SharedItem[] = [];
  const give = (busId: string, item: SharedItem) => {
    const groups = byBus.get(busId) ?? noGroups();
    groups[item.group] += item.amountInr;
    byBus.set(busId, groups);
    items.set(busId, [...(items.get(busId) ?? []), item]);
  };
  const share = (base: Omit<SharedItem, "amountInr">, amountInr: number, weights: (readonly [string, number])[]) => {
    if (!amountInr) return;
    if (weights.length === 0) {
      unshared[base.group] += amountInr;
      unsharedItems.push({ ...base, amountInr });
      return;
    }
    let parts = splitByWeight(amountInr, weights);
    if (parts.size === 0) parts = splitByWeight(amountInr, weights.map(([id]) => [id, 1] as const));
    for (const [busId, part] of parts) if (part) give(busId, { ...base, amountInr: part });
  };
  const byDays = (targets: string[]) => targets.map((id) => [id, days.get(id) ?? 0] as const);
  // Every bus of the company, even ones this login can't see.
  const fleet = data.companyBusDays?.map((item) => ({ id: item.busId, busType: item.busType })) ?? data.buses;
  for (const cost of data.companyExpenses) {
    const part = costInRange(cost, filters);
    const base = {
      id: cost.id,
      label: companyExpenseLabel(cost.category) + (cost.note ? ` · ${cost.note}` : ""),
      date: cost.spentOn,
      group: (FIXED_COSTS.has(cost.category) ? "fixed" : "overhead") as CostGroup,
    };
    // Office rent, EMIs, the auditor: paid whether a bus runs or not, so split equally.
    share(base, part, costTargets(cost, fleet).map((id) => [id, 1] as const));
  }
  for (const salary of data.salaries) {
    if (!inRange(salary.paidOn, filters)) continue;
    const person = data.people.find((item) => item.id === salary.personId);
    const base = {
      id: salary.id,
      label: `Salary · ${person?.name ?? "Crew"}`,
      date: salary.paidOn,
      group: "salary" as CostGroup,
    };
    const month = salary.forMonth.slice(0, 7);
    const worked = new Map<string, number>();
    for (const row of data.dayCrew) {
      if (row.personId === salary.personId && row.date.slice(0, 7) === month) {
        worked.set(row.busId, (worked.get(row.busId) ?? 0) + 1);
      }
    }
    if (worked.size) {
      share(base, salary.amountInr, [...worked]);
    } else {
      const targets = fleet.filter((bus) => !person || bus.busType === person.module).map((bus) => bus.id);
      share(base, salary.amountInr, byDays(targets));
    }
  }
  return { byBus, items, unshared, unsharedItems };
}

export type BusProfitLine = {
  bus: Bus;
  moneyIn: number;
  ownCosts: number;
  /** Money in minus own costs, before company costs. */
  busProfit: number;
  /** This bus's share of company costs and salaries. */
  shared: number;
  /** The share, split into fixed costs, company overheads and salaries. */
  sharedParts: Record<CostGroup, number>;
  /** Each company cost and salary behind the share. */
  sharedItems: SharedItem[];
  /** Bus profit minus its share. */
  profit: number;
  km: number;
  daysRun: number;
  /** Days in the range the bus did not run. */
  daysOff: number;
  /** Of those, days marked off road. */
  offRoadDays: number;
  /** Own costs by where they came from. */
  ownParts: { ledger: number; trips: number; tyres: number };
};

/**
 * Every bus's figures for the date range (the bus and type filters are not
 * applied, so shares are the same whatever is picked), plus the company
 * money that falls on no bus.
 */
export function busProfitLines(data: ReportData, filters: ReportFilters) {
  const all = new Set(data.buses.map((bus) => bus.id));
  const days = daysRunByBus(data, filters);
  const shared = sharedCostsByBus(data, filters, days);
  const income = intercityShares(data, filters);
  const tyres = tyreChargesByBus(data, filters);
  const trips = tripsInRange(data, filters, all);
  const entries = data.entries.filter((entry) => inRange(entry.date, filters));
  const length = rangeDays(filters);
  const lines: BusProfitLine[] = data.buses.map((bus) => {
    const busEntries = entries.filter((entry) => entry.busId === bus.id);
    const busTrips = trips.filter((trip) => trip.busId === bus.id);
    const moneyIn =
      sum(busEntries.filter((entry) => entry.kind === "income").map((entry) => entry.amountInr)) +
      (income.get(bus.id) ?? 0);
    const ownParts = {
      ledger: sum(busEntries.filter((entry) => entry.kind === "expense").map((entry) => entry.amountInr)),
      trips: sum(
        busTrips.map((trip) => {
          const totals = tripTotals(trip);
          return totals.dieselInr + totals.cashExpensesInr;
        }),
      ),
      tyres: tyres.get(bus.id) ?? 0,
    };
    const ownCosts = ownParts.ledger + ownParts.trips + ownParts.tyres;
    const tripKm = sum(busTrips.map((trip) => tripTotals(trip).kmRun ?? 0));
    const readings = data.odometers.filter((item) => item.busId === bus.id);
    const inside = readings.filter((item) => inRange(item.date, filters)).map((item) => item.km);
    const before = readings.filter((item) => item.date < filters.from).map((item) => item.km);
    const odometerKm = inside.length
      ? Math.max(...inside) - (before.length ? Math.max(...before) : Math.min(...inside))
      : 0;
    const km = tripKm || Math.max(odometerKm, 0);
    const sharedParts = shared.byBus.get(bus.id) ?? noGroups();
    const share = groupTotal(sharedParts);
    const daysRun = days.get(bus.id) ?? 0;
    return {
      bus,
      moneyIn,
      ownCosts,
      busProfit: moneyIn - ownCosts,
      shared: share,
      sharedParts,
      sharedItems: shared.items.get(bus.id) ?? [],
      profit: moneyIn - ownCosts - share,
      km,
      daysRun,
      daysOff: Math.max(length - daysRun, 0),
      offRoadDays: data.offRoad.filter((item) => item.busId === bus.id && inRange(item.date, filters)).length,
      ownParts,
    };
  });
  return {
    lines,
    unshared: groupTotal(shared.unshared),
    unsharedParts: shared.unshared,
    unsharedItems: shared.unsharedItems,
    scrap: scrapInRange(data, filters),
  };
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

/** Profit per km over the buses that have km; empty when none do. */
function perKmOf(lines: readonly Pick<BusProfitLine, "profit" | "km">[]): number | "" {
  const withKm = lines.filter((line) => line.km > 0);
  const km = sum(withKm.map((line) => line.km));
  return km > 0 ? Math.round((sum(withKm.map((line) => line.profit)) / km) * 100) / 100 : "";
}

/** Column positions of the Profit by bus table. */
export const BUS_PROFIT_COLUMNS = {
  bus: 0,
  type: 1,
  moneyIn: 2,
  ownCosts: 3,
  busProfit: 4,
  shared: 5,
  profit: 6,
  km: 7,
  perKm: 8,
  daysRun: 9,
  daysOff: 10,
} as const;

/** What the bus breakdown panel shows for one row of Profit by bus. */
export type BusDetail = {
  title: string;
  daysRun: number;
  daysOff: number;
  offRoadDays: number;
  rangeDays: number;
  moneyIn: number;
  ownParts: { ledger: number; trips: number; tyres: number };
  sharedParts: Record<CostGroup, number>;
  sharedItems: SharedItem[];
  profit: number;
};

export function busProfitReport(data: ReportData, filters: ReportFilters): ReportTable {
  const { lines, unshared, unsharedItems, unsharedParts, scrap } = busProfitLines(data, filters);
  const length = rangeDays(filters);
  const picked = new Set(selectedBuses(data, filters).map((bus) => bus.id));
  const shown = lines.filter((line) => picked.has(line.bus.id)).sort(byProfit);
  const others = lines.filter((line) => !picked.has(line.bus.id));
  const details: (BusDetail | null)[] = [];
  const rows: Cell[][] = shown.map((line) => {
    details.push({
      title: `${line.bus.registrationNumber} · ${BUS_TYPE_LABELS[line.bus.busType]}`,
      daysRun: line.daysRun,
      daysOff: line.daysOff,
      offRoadDays: line.offRoadDays,
      rangeDays: length,
      moneyIn: line.moneyIn,
      ownParts: line.ownParts,
      sharedParts: line.sharedParts,
      sharedItems: line.sharedItems,
      profit: line.profit,
    });
    return [
      line.bus.registrationNumber,
      BUS_TYPE_LABELS[line.bus.busType],
      line.moneyIn,
      line.ownCosts,
      line.busProfit,
      -line.shared,
      line.profit,
      line.km,
      perKmOf([line]),
      line.daysRun,
      line.daysOff,
    ];
  });
  const extraRows: number[] = [];
  const extra = (row: Cell[], detail: BusDetail | null = null) => {
    extraRows.push(rows.length);
    rows.push(row);
    details.push(detail);
  };
  // Filtered to some buses: the rest of the company, so the total is still the company's profit.
  if (others.length) {
    const otherTypes = [...new Set(others.map((line) => BUS_TYPE_LABELS[line.bus.busType]))].join(", ");
    const t = (pick: (line: BusProfitLine) => number) => sum(others.map(pick));
    extra([
      filters.busId ? "Other buses" : `Other types (${otherTypes})`,
      `${others.length} bus${others.length === 1 ? "" : "es"}`,
      t((line) => line.moneyIn),
      t((line) => line.ownCosts),
      t((line) => line.busProfit),
      -t((line) => line.shared),
      t((line) => line.profit),
      t((line) => line.km),
      perKmOf(others),
      "",
      "",
    ]);
  }
  if (unshared) {
    extra(["Costs with no bus", "", 0, 0, 0, -unshared, -unshared, "", "", "", ""], {
      title: "Costs with no bus",
      daysRun: 0,
      daysOff: 0,
      offRoadDays: 0,
      rangeDays: length,
      moneyIn: 0,
      ownParts: { ledger: 0, trips: 0, tyres: 0 },
      sharedParts: unsharedParts,
      sharedItems: unsharedItems,
      profit: -unshared,
    });
  }
  if (scrap) extra(["Tyre scrap sold", "", scrap, 0, scrap, 0, scrap, "", "", "", ""]);

  const column = (index: number) => sum(rows.map((row) => Number(row[index]) || 0));
  const total: Cell[] = [
    extraRows.length ? "Company total" : `Total · ${shown.length} bus${shown.length === 1 ? "" : "es"}`,
    "",
    column(2),
    column(3),
    column(4),
    column(5),
    column(6),
    column(7),
    perKmOf(extraRows.length ? lines : shown),
    "",
    "",
  ];
  // Every type: the headline is the company's figures, the same as Profit & loss.
  // Filtered: the picked buses only.
  const whole = !filters.busId && !filters.busType;
  const own = (pick: (line: BusProfitLine) => number) => sum(shown.map(pick));
  const headline = whole
    ? { busProfit: column(4), shared: column(5), profit: column(6), km: column(7), perKm: perKmOf(lines) }
    : {
        busProfit: own((line) => line.busProfit),
        shared: -own((line) => line.shared),
        profit: own((line) => line.profit),
        km: own((line) => line.km),
        perKm: perKmOf(shown),
      };
  const scope = whole ? "" : filters.busId ? " (this bus)" : ` (${BUS_TYPE_LABELS[filters.busType as BusKind]} buses)`;
  const notes = [
    "Bus profit = the bus's money in minus its own costs (ledger, trip sheets, tyres), before company costs.",
    "Shared costs: each bank or company cost (EMI, insurance, office rent, auditor…) is split equally among the buses it applies to, whether they ran or not. Costs paid for several months are spread day by day over those months.",
    "Crew salaries go to the buses the person worked on the Town day crew that month, otherwise to the buses of their type by days run. Intercity money is split equally across its buses; tour payments go to the bus on the booking.",
    "A day counts as run if the bus had an approved trip, money in, a running cost (diesel, AdBlue, toll, crew bata, police, parking), an odometer reading higher than the last, or Town day crew. Repair bills alone and days marked off road don't count.",
  ];
  for (const line of shown) {
    if (!line.daysRun && line.shared) {
      notes.push(
        `${line.bus.registrationNumber} didn't run on any of the ${length} days${line.offRoadDays ? ` (${line.offRoadDays} marked off road)` : ""}; it still carries ${formatInr(line.shared)} of company costs.`,
      );
    }
  }
  if (extraRows.length) {
    notes.push("The company total includes other buses, costs with no bus and tyre scrap, so it matches the company's profit in Profit & loss.");
  }
  return {
    title: "Profit by bus",
    columns: [
      "Bus",
      "Type",
      "Money in",
      "Own costs",
      "Bus profit",
      "Shared costs",
      "Profit",
      "Km",
      "₹ / km",
      "Days run",
      "Days not run",
    ],
    moneyColumns: [2, 3, 4, 5, 6],
    toneColumns: [5, 6],
    rateColumns: [8],
    shareColumns: [0, 6, 9],
    rows,
    total,
    extraRows,
    details,
    summary: [
      { label: `Bus profit, before company costs${scope}`, value: headline.busProfit, format: "money" },
      { label: `Shared costs${scope}`, value: headline.shared, tone: "out" },
      {
        label: whole ? "Company profit" : `Profit after shared costs${scope}`,
        value: headline.profit,
        tone: headline.profit >= 0 ? "in" : "out",
      },
      {
        label: "Profit per km",
        value: typeof headline.perKm === "number" ? headline.perKm : 0,
        format: typeof headline.perKm === "number" ? "rate" : "none",
        detail: headline.km > 0 ? `${headline.km.toLocaleString("en-IN")} km` : "no km recorded",
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
