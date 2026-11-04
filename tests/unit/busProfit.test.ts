import { describe, expect, it } from "vitest";
import type { CompanyExpense, CrewPerson, SalaryPayment } from "@domain/money/types";
import type { Bus, DailyEntry } from "@domain/operations/types";
import {
  BUS_PROFIT_COLUMNS as C,
  bestAndWorst,
  costInRange,
  busProfitLines,
  busProfitReport,
  daysRunByBus,
  pnlReport,
  splitByWeight,
  type ReportData,
  type ReportFilters,
} from "@domain/reports/build";
import type { Trip } from "@domain/trips/types";

const bus = (id: string, busType: Bus["busType"]): Bus =>
  ({ id, registrationNumber: id, routeLabel: "", busType, seats: null, permitType: "", runsWith: "" }) as Bus;

const entry = (busId: string, date: string, kind: "income" | "expense", amountInr: number): DailyEntry => ({
  id: `${busId}-${date}-${kind}-${amountInr}`,
  busId,
  date,
  kind,
  category: kind === "income" ? "tickets" : "diesel",
  amountInr,
  note: "",
  createdAt: `${date}T10:00:00Z`,
}) as DailyEntry;

const cost = (
  id: string,
  amountInr: number,
  appliesTo: CompanyExpense["appliesTo"],
  extra: Partial<CompanyExpense> = {},
): CompanyExpense => ({
  id,
  appliesTo,
  appliesType: null,
  busIds: [],
  spentOn: "2026-11-04",
  category: "loan_emi",
  amountInr,
  paidVia: "bank",
  note: "",
  spreadMonths: 1,
  repeatMonthly: false,
  ...extra,
});

const trip: Trip = {
  id: "trip1",
  busId: "O1",
  sheetNo: "1",
  route: "Chennai",
  // 5 Nov 8 pm to 7 Nov 8 am, India time: three days on the road.
  startedAt: "2026-11-05T14:30:00Z",
  endedAt: "2026-11-07T02:30:00Z",
  haltNote: "",
  driver1: "Murugan",
  driver2: "",
  cleaner: "",
  startKm: 1000,
  endKm: 1600,
  advanceInr: 0,
  writtenTotalInr: null,
  photoPath: "",
  status: "approved",
  approvedAt: "2026-11-07T05:00:00Z",
  settledOn: null,
  diesel: [{ litres: 120, amountInr: 6000, paidBy: "credit", pump: "IOC" }],
  expenses: [{ category: "toll", amountInr: 500, note: "" }],
};

const buses = [bus("T1", "town"), bus("T2", "town"), bus("O1", "omni"), bus("R1", "tour")];

const data: ReportData = {
  buses,
  allBusIds: buses.map((item) => item.id),
  people: [{ id: "p1", name: "Ravi", job: "conductor", phone: "", monthlySalaryInr: 800, licenceNo: "", active: true, module: "town" } as CrewPerson],
  entries: [
    entry("T1", "2026-11-01", "income", 10000),
    entry("T1", "2026-11-01", "expense", 2000),
    entry("T1", "2026-11-02", "income", 10000),
    entry("T1", "2026-11-03", "income", 10000),
    entry("T2", "2026-11-01", "income", 5000),
  ],
  trips: [trip],
  companyExpenses: [
    // Days run: T1 3, T2 1, O1 3, R1 0 (7 in all).
    cost("all", 7000, "all"),
    cost("town", 4000, "type", { appliesType: "town" }),
    // R1 never ran, but this cost is R1's alone, so R1 still carries it.
    cost("idle", 900, "buses", { busIds: ["R1"] }),
    cost("one", 1000, "buses", { busIds: ["O1"] }),
    cost("old", 5000, "all", { spentOn: "2026-10-31" }),
  ],
  salaries: [{ id: "s1", personId: "p1", forMonth: "2026-11-01", paidOn: "2026-11-10", amountInr: 800, note: "" } as SalaryPayment],
  intercity: [{ id: "i1", periodStart: "2026-11-01", periodEnd: "2026-11-15", receivedOn: "2026-11-16", amountInr: 3000, busIds: ["O1", "R1"], note: "" }],
  renewals: [],
  tourBookings: [],
  tourPayments: [],
  tyres: [],
  tyreEvents: [],
  scrapSales: [{ id: "x1", soldOn: "2026-11-20", amountInr: 300 } as ReportData["scrapSales"][number]],
  warrantyCredits: [],
  odometers: [
    { busId: "T1", date: "2026-11-01", km: 100 },
    { busId: "T1", date: "2026-11-03", km: 400 },
  ],
  companyBusDays: null,
  dayCrew: [],
  offRoad: [],
};

const filters: ReportFilters = { from: "2026-11-01", to: "2026-11-30", busId: "", busType: "", renewalDays: 30 };

describe("splitting company costs", () => {
  it("splits whole rupees by weight and keeps the total", () => {
    const parts = splitByWeight(1000, [["a", 1], ["b", 1], ["c", 1]]);
    expect([...parts.values()].reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts.get("a")).toBe(334);
    expect(splitByWeight(700, [["a", 3], ["b", 0], ["c", 4]])).toEqual(new Map([["a", 300], ["c", 400]]));
    expect(splitByWeight(500, [["a", 0]]).size).toBe(0);
  });

  it("counts days with an entry or an approved trip on the road", () => {
    const days = daysRunByBus(data, filters);
    expect(days.get("T1")).toBe(3);
    expect(days.get("T2")).toBe(1);
    expect(days.get("O1")).toBe(3);
    expect(days.get("R1")).toBeUndefined();
    // A range cutting the trip counts only its days inside.
    expect(daysRunByBus(data, { ...filters, from: "2026-11-06" }).get("O1")).toBe(2);
  });
});

describe("profit by bus", () => {
  const { lines, unshared, scrap } = busProfitLines(data, filters);
  const line = (id: string) => lines.find((item) => item.bus.id === id)!;

  it("splits company costs equally among the buses each applies to, and crew salaries by days run", () => {
    // All 7000 in four, Town 4000 in two, salary 800 by days run 3:1, O1's own 1000, R1's own 900.
    expect(line("T1").shared).toBe(1750 + 2000 + 600);
    expect(line("T2").shared).toBe(1750 + 2000 + 200);
    expect(line("O1").shared).toBe(1750 + 1000);
    // R1 never ran but still carries its part of the company costs.
    expect(line("R1").shared).toBe(1750 + 900);
    expect(line("R1").daysOff).toBe(30);
    expect(unshared).toBe(0);
    expect(scrap).toBe(300);
  });

  it("works out bus profit, profit after shared costs and km", () => {
    expect(line("T1")).toMatchObject({ moneyIn: 30000, ownCosts: 2000, busProfit: 28000, profit: 23650, km: 300 });
    expect(line("O1")).toMatchObject({ moneyIn: 1500, ownCosts: 6500, busProfit: -5000, profit: -7750, km: 600 });
    expect(line("R1")).toMatchObject({ moneyIn: 1500, profit: -1150 });
    expect(line("T1").sharedParts).toEqual({ fixed: 3750, overhead: 0, salary: 600 });
  });

  it("lists the most profitable first and the total matches Profit & loss", () => {
    const table = busProfitReport(data, filters);
    expect(table.rows.map((row) => row[C.bus])).toEqual(["T1", "T2", "R1", "O1", "Tyre scrap sold"]);
    expect(table.total?.[C.profit]).toBe(16100);
    expect(pnlReport(data, filters).total?.[7]).toBe(16100);
    // The headline is the company's profit, the same as the total (M1).
    expect(table.summary.find((item) => item.label === "Company profit")?.value).toBe(16100);
    // Rate per km only where km were recorded (L2): T1 and O1, 900 km in all.
    expect(table.rows[0][C.perKm]).toBe(78.83);
    expect(table.rows[1][C.perKm]).toBe("");
    // (23650 − 7750) / 900 km.
    expect(table.total?.[C.perKm]).toBe(17.67);
    expect(table.rows[2][C.daysRun]).toBe(0);
    expect(table.rows[2][C.daysOff]).toBe(30);
  });

  it("filtered to one type, shows what was left for other types so it still reconciles", () => {
    const table = busProfitReport(data, { ...filters, busType: "town" });
    expect(table.rows.map((row) => row[C.bus])).toEqual(["T1", "T2", "Other types (Omni, Tour)", "Tyre scrap sold"]);
    expect(table.rows[2][C.profit]).toBe(-8900);
    expect(table.total?.[C.profit]).toBe(16100);
    expect(table.summary.find((item) => item.label.startsWith("Profit after shared costs"))?.value).toBe(24700);
  });

  it("a manager who sees only Omni gets the same Omni shares as the admin", () => {
    const omniOnly: ReportData = {
      ...data,
      buses: buses.filter((item) => item.busType === "omni"),
      entries: [],
      salaries: [],
      companyExpenses: data.companyExpenses.filter((item) => item.appliesTo !== "type"),
      // The database lists every bus, with 0 for one that didn't run.
      companyBusDays: buses.map((item) => ({
        busId: item.id,
        busType: item.busType,
        days: daysRunByBus(data, filters).get(item.id) ?? 0,
      })),
    };
    const o1 = busProfitLines(omniOnly, filters).lines.find((item) => item.bus.id === "O1")!;
    expect(o1.shared).toBe(line("O1").shared);
  });

  it("picks the best and worst bus", () => {
    const pair = bestAndWorst(lines);
    expect(pair?.best.bus.id).toBe("T1");
    expect(pair?.worst?.bus.id).toBe("O1");
    expect(bestAndWorst(lines.filter((item) => item.bus.busType === "omni"))?.worst).toBeNull();
  });
});

describe("days run (D7)", () => {
  const base: ReportData = { ...data, entries: [], trips: [], odometers: [], companyBusDays: null };
  const repair = { ...entry("T1", "2026-11-02", "expense", 900), category: "repair" } as DailyEntry;

  it("does not count a day with only a repair bill", () => {
    expect(daysRunByBus({ ...base, entries: [repair] }, filters).get("T1")).toBeUndefined();
  });

  it("counts a running cost, a higher odometer reading and Town day crew", () => {
    const days = daysRunByBus(
      {
        ...base,
        entries: [entry("T1", "2026-11-02", "expense", 500)],
        odometers: [
          { busId: "T2", date: "2026-11-04", km: 100 },
          { busId: "T2", date: "2026-11-05", km: 100 },
          { busId: "T2", date: "2026-11-06", km: 180 },
        ],
        dayCrew: [{ busId: "O1", date: "2026-11-09", personId: "p1" }],
      },
      filters,
    );
    expect(days.get("T1")).toBe(1);
    // The 5th repeats the reading, so only the 6th counts.
    expect(days.get("T2")).toBe(1);
    expect(days.get("O1")).toBe(1);
  });

  it("leaves out days marked off road", () => {
    const days = daysRunByBus({ ...data, offRoad: [{ busId: "T1", date: "2026-11-02" }] }, filters);
    expect(days.get("T1")).toBe(2);
  });
});

describe("shared costs", () => {
  it("splits a company cost equally, whether its buses ran or not", () => {
    const parked: ReportData = {
      ...data,
      companyExpenses: [cost("pair", 1001, "buses", { busIds: ["R1", "T2"] })],
      entries: [],
      salaries: [],
    };
    const lines = busProfitLines(parked, filters).lines;
    const shared = (id: string) => lines.find((item) => item.bus.id === id)!.shared;
    expect(shared("R1") + shared("T2")).toBe(1001);
    expect(Math.abs(shared("R1") - shared("T2"))).toBeLessThanOrEqual(1);
  });

  it("gives a salary to the buses the person worked on", () => {
    const crewed: ReportData = {
      ...data,
      companyExpenses: [],
      dayCrew: [{ busId: "T2", date: "2026-11-01", personId: "p1" }],
    };
    const lines = busProfitLines(crewed, filters).lines;
    expect(lines.find((item) => item.bus.id === "T2")!.sharedParts.salary).toBe(800);
    expect(lines.find((item) => item.bus.id === "T1")!.sharedParts.salary).toBe(0);
  });
});

describe("spreading a cost over months (D8)", () => {
  const yearly = { spentOn: "2026-11-15", spreadMonths: 12 as const, amountInr: 36500 };

  it("counts only the share for the dates asked, and whole months add up", () => {
    expect(costInRange(yearly, { from: "2026-11-01", to: "2026-11-30" })).toBe(3000);
    expect(costInRange(yearly, { from: "2026-11-01", to: "2027-10-31" })).toBe(36500);
    expect(costInRange(yearly, { from: "2026-10-01", to: "2026-10-31" })).toBe(0);
    const months = Array.from({ length: 12 }, (_, index) => {
      const start = new Date(Date.UTC(2026, 10 + index, 1)).toISOString().slice(0, 10);
      const end = new Date(Date.UTC(2026, 11 + index, 0)).toISOString().slice(0, 10);
      return costInRange(yearly, { from: start, to: end });
    });
    expect(months.reduce((a, b) => a + b, 0)).toBe(36500);
  });

  it("a one-month cost falls wholly in its month", () => {
    expect(costInRange({ ...yearly, spreadMonths: 1 }, { from: "2026-11-01", to: "2026-11-30" })).toBe(36500);
  });
});
