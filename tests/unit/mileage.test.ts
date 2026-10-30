import { describe, expect, it } from "vitest";
import {
  median,
  mileageSummary,
  periodRange,
  townPoints,
  tripPoints,
  type MileageBus,
  type MileagePoint,
  type TownFill,
} from "@domain/mileage/mileage";
import type { Trip } from "@domain/trips/types";

const omni: MileageBus = { id: "b1", registrationNumber: "TN 45 AB 1201", busType: "omni", targetKmpl: null, tankLitres: null };

function trip(id: string, day: string, km: number, litres: number, extra: Partial<Trip> = {}): Trip {
  return {
    id,
    busId: "b1",
    sheetNo: id,
    route: "",
    startedAt: `${day}T06:00:00+05:30`,
    endedAt: null,
    haltNote: "",
    driver1: "R. Kumar",
    driver2: "",
    cleaner: "",
    startKm: 100000,
    endKm: 100000 + km,
    advanceInr: 0,
    writtenTotalInr: null,
    photoPath: "",
    status: "approved",
    approvedAt: null,
    settledOn: null,
    diesel: [{ litres, amountInr: litres * 95, paidBy: "credit", pump: "Pump" }],
    expenses: [],
    ...extra,
  };
}

/** Ten steady trips at 4 km/L in September, then the given October trips. */
function points(october: [number, number][]): MileagePoint[] {
  const trips = [
    ...Array.from({ length: 10 }, (_, index) =>
      trip(`s${index}`, `2026-09-${String(index + 10).padStart(2, "0")}`, 800, 200),
    ),
    ...october.map(([km, litres], index) => trip(`o${index}`, `2026-10-${String(index + 10).padStart(2, "0")}`, km, litres)),
  ];
  return tripPoints(trips);
}

const october = { from: "2026-10-01", to: "2026-10-31" };

describe("mileage points", () => {
  it("works out km per litre from approved trip sheets only", () => {
    const list = tripPoints([
      trip("1", "2026-10-01", 800, 200),
      trip("2", "2026-10-02", 800, 200, { status: "draft" }),
      trip("3", "2026-10-03", 800, 0),
      trip("4", "2026-10-04", 9000, 200),
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].kmpl).toBe(4);
    expect(list[0].label).toBe("sheet 1");
    expect(list[0].drivers).toEqual(["R. Kumar"]);
  });

  it("measures town buses from one full tank to the next", () => {
    const fills: TownFill[] = [
      { id: "f1", busId: "t1", date: "2026-10-01", createdAt: "1", litres: 80, amountInr: 7600, odometerKm: 50000, fullTank: true },
      { id: "f2", busId: "t1", date: "2026-10-02", createdAt: "2", litres: 40, amountInr: 3800, odometerKm: null, fullTank: false },
      { id: "f3", busId: "t1", date: "2026-10-03", createdAt: "3", litres: 60, amountInr: 5700, odometerKm: 50500, fullTank: true },
    ];
    const list = townPoints(fills);
    expect(list).toHaveLength(1);
    expect(list[0].km).toBe(500);
    expect(list[0].litres).toBe(100);
    expect(list[0].kmpl).toBe(5);
    expect(list[0].key).toBe("fill:f3");
  });

  it("takes the middle value, so one bad sheet doesn't move the usual", () => {
    expect(median([4, 4.1, 3.9, 1])).toBe(3.95);
    expect(median([])).toBeNull();
  });
});

describe("mileage alerts", () => {
  it("leaves a steady bus alone", () => {
    const summary = mileageSummary({ buses: [omni], points: points([[800, 200]]), checkedKeys: new Set(), ...october });
    expect(summary.buses[0].status).toBe("ok");
    expect(summary.buses[0].reason).toBe("Steady");
    expect(summary.buses[0].usual).toBe(4);
    expect(summary.openAlerts).toBe(0);
  });

  it("raises an alert for a big drop and counts the diesel lost", () => {
    // 600 km on 200 L is 3 km/L, 25%+ below the usual 4.
    const summary = mileageSummary({ buses: [omni], points: points([[590, 200]]), checkedKeys: new Set(), ...october });
    const view = summary.buses[0];
    expect(view.status).toBe("alert");
    expect(view.reason).toBe("Dropped 26% on sheet o0");
    expect(view.alerts[0].extraLitres).toBeCloseTo(52.5);
    expect(summary.lostInr).toBe(Math.round(52.5 * 95));
    expect(view.recent.at(-1)?.flagged).toBe(true);
  });

  it("asks for a check on a smaller drop", () => {
    const summary = mileageSummary({ buses: [omni], points: points([[660, 200]]), checkedKeys: new Set(), ...october });
    expect(summary.buses[0].status).toBe("warn");
  });

  it("flags mileage too high to be right", () => {
    const summary = mileageSummary({ buses: [omni], points: points([[1100, 200]]), checkedKeys: new Set(), ...october });
    expect(summary.buses[0].alerts[0].rule).toBe("jump");
  });

  it("spots mileage falling over three trips", () => {
    const summary = mileageSummary({
      buses: [omni],
      points: points([[720, 200], [710, 200], [700, 200]]),
      checkedKeys: new Set(),
      ...october,
    });
    expect(summary.buses[0].reason).toBe("Falling for 3 trips in a row");
  });

  it("flags a fill bigger than the tank", () => {
    const bus = { ...omni, tankLitres: 150 };
    const summary = mileageSummary({ buses: [bus], points: points([[800, 200]]), checkedKeys: new Set(), ...october });
    expect(summary.buses[0].alerts.map((alert) => alert.rule)).toContain("overfill");
  });

  it("uses the owner's own target when set", () => {
    const bus = { ...omni, targetKmpl: 5 };
    const summary = mileageSummary({ buses: [bus], points: points([[800, 200]]), checkedKeys: new Set(), ...october });
    expect(summary.buses[0].status).toBe("warn");
  });

  it("drops an alert once it is marked checked", () => {
    const summary = mileageSummary({
      buses: [omni],
      points: points([[590, 200]]),
      checkedKeys: new Set(["drop:trip:o0"]),
      ...october,
    });
    expect(summary.buses[0].status).toBe("ok");
    expect(summary.buses[0].reason).toBe("Checked: Dropped 26% on sheet o0");
    expect(summary.openAlerts).toBe(0);
  });

  it("only raises alerts for the chosen period", () => {
    const summary = mileageSummary({
      buses: [omni],
      points: points([[590, 200]]),
      checkedKeys: new Set(),
      from: "2026-11-01",
      to: "2026-11-30",
    });
    expect(summary.buses[0].status).toBe("ok");
  });

  it("puts buses without data last", () => {
    const empty = { ...omni, id: "b2", registrationNumber: "TN 45 AA 0001" };
    const summary = mileageSummary({ buses: [empty, omni], points: points([[590, 200]]), checkedKeys: new Set(), ...october });
    expect(summary.buses.map((view) => view.status)).toEqual(["alert", "none"]);
  });
});

describe("periods", () => {
  it("gives India date ranges", () => {
    expect(periodRange("this_month", "2026-10-30")).toEqual({ from: "2026-10-01", to: "2026-10-30" });
    expect(periodRange("last_month", "2026-03-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("last_3_months", "2026-01-20")).toEqual({ from: "2025-11-01", to: "2026-01-20" });
  });
});
