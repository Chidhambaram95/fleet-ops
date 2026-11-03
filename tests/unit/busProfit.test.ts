import { describe, expect, it } from "vitest";
import type { CompanyExpense, CrewPerson, SalaryPayment } from "@domain/money/types";
import type { Bus, DailyEntry } from "@domain/operations/types";
import {
  bestAndWorst,
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
    // R1 never ran: nobody takes this one.
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

  it("shares costs by days run, among the buses each cost applies to", () => {
    // All 7000 by 3:1:3:0, Town 4000 by 3:1, salary 800 by 3:1, O1's own 1000.
    expect(line("T1").shared).toBe(3000 + 3000 + 600);
    expect(line("T2").shared).toBe(1000 + 1000 + 200);
    expect(line("O1").shared).toBe(3000 + 1000);
    expect(line("R1").shared).toBe(0);
    expect(unshared).toBe(900);
    expect(scrap).toBe(300);
  });

  it("works out bus profit, profit after shared costs and km", () => {
    expect(line("T1")).toMatchObject({ moneyIn: 30000, ownCosts: 2000, busProfit: 28000, profit: 21400, km: 300 });
    expect(line("O1")).toMatchObject({ moneyIn: 1500, ownCosts: 6500, busProfit: -5000, profit: -9000, km: 600 });
    expect(line("R1")).toMatchObject({ moneyIn: 1500, profit: 1500 });
  });

  it("lists the most profitable first and the total matches Profit & loss", () => {
    const table = busProfitReport(data, filters);
    expect(table.rows.map((row) => row[1])).toEqual(["T1", "T2", "R1", "O1", "Company costs no bus ran for", "Tyre scrap sold"]);
    expect(table.total?.[7]).toBe(16100);
    expect(pnlReport(data, filters).total?.[7]).toBe(16100);
    expect(table.rows[0][9]).toBe(71.33);
  });

  it("filtered to one type, shows what was left for other types so it still reconciles", () => {
    const table = busProfitReport(data, { ...filters, busType: "town" });
    expect(table.rows.map((row) => row[1])).toEqual([
      "T1",
      "T2",
      "Other types (Omni, Tour)",
      "Company costs no bus ran for",
      "Tyre scrap sold",
    ]);
    expect(table.rows[2][7]).toBe(-7500);
    expect(table.total?.[7]).toBe(16100);
    expect(table.summary.find((item) => item.label === "Profit after shared costs")?.value).toBe(24200);
  });

  it("a manager who sees only Omni gets the same Omni shares as the admin", () => {
    const omniOnly: ReportData = {
      ...data,
      buses: buses.filter((item) => item.busType === "omni"),
      entries: [],
      salaries: [],
      companyExpenses: data.companyExpenses.filter((item) => item.appliesTo !== "type"),
      companyBusDays: [...daysRunByBus(data, filters)].map(([busId, days]) => ({
        busId,
        busType: buses.find((item) => item.id === busId)!.busType,
        days,
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
