import { formatInr, shiftDate, todayInIst } from "@domain/operations/totals";
import type { Trip } from "@domain/trips/types";

/**
 * Mileage (km per litre) for each bus, and the alerts the office should look at.
 *
 * Omni and Tour: one point per approved trip sheet, km run ÷ diesel litres.
 * Town: one point per full tank, km since the last full tank ÷ litres put in
 * since then (this fill included).
 */

/** A trip sheet goes on the chart only up to this many km; more is a typo. */
const MAX_KM = 3000;
/** Points shorter than this don't count towards a bus's usual. */
const MIN_KM_FOR_USUAL = 50;
/** The usual is the middle of this many recent points... */
const USUAL_POINTS = 10;
/** ...once a bus has at least this many. */
const MIN_POINTS_FOR_USUAL = 5;

export const LIMITS = {
  /** Below usual by this share: Check. */
  warnDrop: 0.15,
  /** Below usual by this share: Alert. */
  alertDrop: 0.25,
  /** Above usual by this share: a fill or the km is probably wrong. */
  jump: 0.25,
  /** Each of the last 3 points this far below usual: slowly falling. */
  decline: 0.08,
  /** A fill this much over the tank size is impossible. */
  overfill: 0.05,
  /** With no usual yet, outside this range is flagged. */
  low: 2.5,
  high: 7,
};

export type MileagePoint = {
  /** "trip:<id>" or "fill:<id>". */
  key: string;
  busId: string;
  /** India date, yyyy-mm-dd. */
  date: string;
  km: number;
  litres: number;
  kmpl: number;
  /** What those litres cost, when known. */
  dieselInr: number;
  /** The largest single fill in this point. */
  biggestFillLitres: number;
  /** "sheet 1184" or "the fill on 12 Oct". */
  label: string;
  tripId: string | null;
  drivers: string[];
};

export type MileageBus = {
  id: string;
  registrationNumber: string;
  busType: string;
  targetKmpl: number | null;
  tankLitres: number | null;
};

/** A town diesel entry with litres. */
export type TownFill = {
  id: string;
  busId: string;
  date: string;
  createdAt: string;
  litres: number;
  amountInr: number;
  odometerKm: number | null;
  fullTank: boolean;
};

export type AlertLevel = "alert" | "warn";
export type AlertRule = "drop" | "jump" | "decline" | "overfill" | "range";

export type MileageAlert = {
  /** Stable id, saved when someone marks it checked. */
  key: string;
  busId: string;
  rule: AlertRule;
  level: AlertLevel;
  date: string;
  pointKey: string;
  tripId: string | null;
  kmpl: number;
  usual: number | null;
  /** Diesel used beyond what the usual mileage needed. */
  extraLitres: number;
  extraInr: number;
  title: string;
  advice: string;
  checked: boolean;
};

export type BusStatus = "alert" | "warn" | "ok" | "none";

export type BusMileageView = {
  bus: MileageBus;
  status: BusStatus;
  /** One line: the worst open alert, or "Steady". */
  reason: string;
  advice: string;
  latestKmpl: number | null;
  /** The bus's usual now, from its latest points (or its target). */
  usual: number | null;
  /** Last 12 points, oldest first, each flagged if it has an open alert. */
  recent: { point: MileagePoint; flagged: boolean }[];
  /** Open alerts in the period, worst first. */
  alerts: MileageAlert[];
};

export type MileageSummary = {
  buses: BusMileageView[];
  counts: Record<BusStatus, number>;
  openAlerts: number;
  /** Diesel lost on trips (or fills) well below the usual, in the period. */
  lostLitres: number;
  lostInr: number;
};

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** India date of an ISO timestamp. */
function istDate(value: string): string {
  return todayInIst(new Date(value));
}

function shortDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(
    new Date(year, month - 1, day),
  );
}

/** One point per approved trip sheet with km and litres. */
export function tripPoints(trips: Trip[]): MileagePoint[] {
  const points: MileagePoint[] = [];
  for (const trip of trips) {
    if (trip.status !== "approved" || trip.startKm == null || trip.endKm == null) continue;
    const km = trip.endKm - trip.startKm;
    const fills = trip.diesel.filter((fill) => (fill.litres ?? 0) > 0);
    const litres = fills.reduce((total, fill) => total + (fill.litres ?? 0), 0);
    if (km <= 0 || km > MAX_KM || litres <= 0) continue;
    const when = trip.startedAt ?? trip.endedAt;
    if (!when) continue;
    points.push({
      key: `trip:${trip.id}`,
      busId: trip.busId,
      date: istDate(when),
      km,
      litres,
      kmpl: km / litres,
      dieselInr: fills.reduce((total, fill) => total + fill.amountInr, 0),
      biggestFillLitres: Math.max(...fills.map((fill) => fill.litres ?? 0)),
      label: trip.sheetNo ? `sheet ${trip.sheetNo}` : `the trip on ${shortDate(istDate(when))}`,
      tripId: trip.id,
      drivers: [trip.driver1, trip.driver2].map((name) => name.trim()).filter(Boolean),
    });
  }
  return points;
}

/** Town: one point per full tank that follows an earlier full tank with an odometer reading. */
export function townPoints(fills: TownFill[]): MileagePoint[] {
  const byBus = new Map<string, TownFill[]>();
  for (const fill of fills) {
    const list = byBus.get(fill.busId) ?? [];
    list.push(fill);
    byBus.set(fill.busId, list);
  }
  const points: MileagePoint[] = [];
  for (const list of byBus.values()) {
    list.sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt));
    let lastFullKm: number | null = null;
    let litres = 0;
    let rupees = 0;
    let biggest = 0;
    for (const fill of list) {
      litres += fill.litres;
      rupees += fill.amountInr;
      biggest = Math.max(biggest, fill.litres);
      if (!fill.fullTank || fill.odometerKm == null) continue;
      const km = lastFullKm == null ? 0 : fill.odometerKm - lastFullKm;
      if (lastFullKm != null && km > 0 && km <= MAX_KM) {
        points.push({
          key: `fill:${fill.id}`,
          busId: fill.busId,
          date: fill.date,
          km,
          litres,
          kmpl: km / litres,
          dieselInr: rupees,
          biggestFillLitres: biggest,
          label: `the fill on ${shortDate(fill.date)}`,
          tripId: null,
          drivers: [],
        });
      }
      // This full tank is where the next one is measured from.
      lastFullKm = fill.odometerKm;
      litres = 0;
      rupees = 0;
      biggest = 0;
    }
  }
  return points;
}

/** The bus's usual before point `index`: its own target, else the middle of its recent points, else its type's. */
export function usualAt(
  points: MileagePoint[],
  index: number,
  target: number | null,
  typeUsual: number | null,
): number | null {
  if (target) return target;
  const before = points
    .slice(0, index)
    .filter((point) => point.km >= MIN_KM_FOR_USUAL)
    .slice(-USUAL_POINTS);
  if (before.length >= MIN_POINTS_FOR_USUAL) return median(before.map((point) => point.kmpl));
  return typeUsual;
}

function pct(value: number) {
  return Math.round(Math.abs(value) * 100);
}

function extraFor(point: MileagePoint, usual: number | null) {
  if (!usual) return { extraLitres: 0, extraInr: 0 };
  const extraLitres = Math.max(0, point.litres - point.km / usual);
  const rate = point.litres > 0 ? point.dieselInr / point.litres : 0;
  return { extraLitres, extraInr: Math.round(extraLitres * rate) };
}

/** The alerts one point raises against the usual it had at the time. */
export function pointAlerts(point: MileagePoint, usual: number | null, bus: MileageBus): Omit<MileageAlert, "checked">[] {
  const alerts: Omit<MileageAlert, "checked">[] = [];
  const base = {
    busId: point.busId,
    date: point.date,
    pointKey: point.key,
    tripId: point.tripId,
    kmpl: point.kmpl,
    usual,
    ...extraFor(point, usual),
  };
  if (usual) {
    const ratio = point.kmpl / usual;
    if (ratio < 1 - LIMITS.warnDrop) {
      const extra = Math.round(base.extraLitres);
      alerts.push({
        ...base,
        key: `drop:${point.key}`,
        rule: "drop",
        level: ratio < 1 - LIMITS.alertDrop ? "alert" : "warn",
        title: `Dropped ${pct(1 - ratio)}% on ${point.label}`,
        advice:
          `${round1(point.kmpl)} km/L against a usual ${round1(usual)}. ` +
          `${extra} L more diesel than usual${base.extraInr ? `, about ${formatInr(base.extraInr)}` : ""}. ` +
          "Check for diesel taken out, a pump giving short litres, or a wrong km figure.",
      });
    } else if (ratio > 1 + LIMITS.jump) {
      alerts.push({
        ...base,
        key: `jump:${point.key}`,
        rule: "jump",
        level: "warn",
        extraLitres: 0,
        extraInr: 0,
        title: `Up ${pct(ratio - 1)}% on ${point.label}, too high to be right`,
        advice: `${round1(point.kmpl)} km/L against a usual ${round1(usual)}. A diesel fill is probably missing, or the km is wrong. Check the sheet.`,
      });
    }
  } else if (point.kmpl < LIMITS.low || point.kmpl > LIMITS.high) {
    alerts.push({
      ...base,
      key: `range:${point.key}`,
      rule: "range",
      level: "warn",
      title: `${round1(point.kmpl)} km/L on ${point.label} looks wrong`,
      advice: "That is unusual for a bus. Check the km and the litres.",
    });
  }
  if (bus.tankLitres && point.biggestFillLitres > bus.tankLitres * (1 + LIMITS.overfill)) {
    alerts.push({
      ...base,
      key: `overfill:${point.key}`,
      rule: "overfill",
      level: "alert",
      title: `${Math.round(point.biggestFillLitres)} L in one fill, more than the ${bus.tankLitres} L tank`,
      advice: "Diesel may have been billed but not put in this bus. Check the pump bill.",
    });
  }
  return alerts;
}

const LEVEL_RANK: Record<AlertLevel, number> = { alert: 0, warn: 1 };

/**
 * Mileage of every bus for the period from..to (India dates, inclusive),
 * with the alerts raised in that period. Points before the period still set the usual.
 */
export function mileageSummary(input: {
  buses: MileageBus[];
  points: MileagePoint[];
  checkedKeys: ReadonlySet<string>;
  from: string;
  to: string;
}): MileageSummary {
  const { buses, checkedKeys, from, to } = input;
  const inPeriod = (date: string) => date >= from && date <= to;

  const pointsByBus = new Map<string, MileagePoint[]>();
  for (const point of input.points) {
    const list = pointsByBus.get(point.busId) ?? [];
    list.push(point);
    pointsByBus.set(point.busId, list);
  }
  for (const list of pointsByBus.values()) {
    list.sort((left, right) => left.date.localeCompare(right.date) || left.key.localeCompare(right.key));
  }

  // Each bus type's own usual, for buses with too few points of their own.
  const typeUsual = new Map<string, number | null>();
  for (const type of new Set(buses.map((bus) => bus.busType))) {
    const values = buses
      .filter((bus) => bus.busType === type)
      .flatMap((bus) => (pointsByBus.get(bus.id) ?? []).filter((point) => point.km >= MIN_KM_FOR_USUAL))
      .map((point) => point.kmpl);
    typeUsual.set(type, values.length >= MIN_POINTS_FOR_USUAL ? median(values) : null);
  }

  let lostLitres = 0;
  let lostInr = 0;
  const views: BusMileageView[] = buses.map((bus) => {
    const points = pointsByBus.get(bus.id) ?? [];
    const fallback = typeUsual.get(bus.busType) ?? null;
    const raised: MileageAlert[] = [];

    points.forEach((point, index) => {
      const usual = usualAt(points, index, bus.targetKmpl, fallback);
      if (!inPeriod(point.date)) return;
      // Only clearly low points count as lost, not the everyday ups and downs.
      if (usual && point.kmpl < usual * (1 - LIMITS.warnDrop)) {
        const extra = extraFor(point, usual);
        lostLitres += extra.extraLitres;
        lostInr += extra.extraInr;
      }
      for (const alert of pointAlerts(point, usual, bus)) {
        raised.push({ ...alert, checked: checkedKeys.has(alert.key) });
      }
    });

    // Slowly falling: the last 3 points all well below the usual from before them.
    const last = points.length - 1;
    if (last >= 2 && inPeriod(points[last].date)) {
      const usual = usualAt(points, last - 2, bus.targetKmpl, fallback);
      const lastThree = points.slice(-3);
      const falling =
        usual != null && lastThree.every((point) => point.kmpl < usual * (1 - LIMITS.decline));
      const alreadyDropped = raised.some((alert) => alert.pointKey === points[last].key && alert.rule === "drop");
      if (falling && !alreadyDropped) {
        const point = points[last];
        const unit = point.tripId ? "trips" : "fills";
        raised.push({
          key: `decline:${point.key}`,
          busId: bus.id,
          rule: "decline",
          level: "warn",
          date: point.date,
          pointKey: point.key,
          tripId: point.tripId,
          kmpl: point.kmpl,
          usual,
          extraLitres: 0,
          extraInr: 0,
          title: `Falling for 3 ${unit} in a row`,
          advice:
            `${lastThree.map((item) => round1(item.kmpl)).join(", ")} km/L against a usual ${round1(usual)}. ` +
            "Book a service: injectors, air filter, tyre pressure and brakes.",
          checked: checkedKeys.has(`decline:${point.key}`),
        });
      }
    }

    const open = raised
      .filter((alert) => !alert.checked)
      .sort((left, right) => LEVEL_RANK[left.level] - LEVEL_RANK[right.level] || right.date.localeCompare(left.date));
    const flaggedPoints = new Set(open.map((alert) => alert.pointKey));
    const declining = open.some((alert) => alert.rule === "decline");
    const recent = points.slice(-12).map((point, index, list) => ({
      point,
      flagged: flaggedPoints.has(point.key) || (declining && index >= list.length - 3),
    }));
    const status: BusStatus = open.length ? open[0].level : points.length ? "ok" : "none";
    return {
      bus,
      status,
      reason:
        open[0]?.title ??
        (raised.length ? `Checked: ${raised[0].title}` : points.length ? "Steady" : "No mileage yet"),
      advice:
        open[0]?.advice ??
        (points.length
          ? "Mileage is within this bus's normal range."
          : bus.busType === "town"
            ? "Enter the odometer and litres with a full-tank diesel entry to start."
            : "Approve trip sheets with km and diesel litres to start."),
      latestKmpl: points.length ? points[points.length - 1].kmpl : null,
      usual: points.length ? usualAt(points, points.length, bus.targetKmpl, fallback) : bus.targetKmpl,
      recent,
      alerts: open,
    };
  });

  const order: Record<BusStatus, number> = { alert: 0, warn: 1, ok: 2, none: 3 };
  views.sort(
    (left, right) =>
      order[left.status] - order[right.status] ||
      left.bus.registrationNumber.localeCompare(right.bus.registrationNumber),
  );
  const counts: Record<BusStatus, number> = { alert: 0, warn: 0, ok: 0, none: 0 };
  for (const view of views) counts[view.status] += 1;
  return {
    buses: views,
    counts,
    openAlerts: views.reduce((total, view) => total + view.alerts.length, 0),
    lostLitres: Math.round(lostLitres),
    lostInr: Math.round(lostInr),
  };
}

export type MileagePeriod = "this_month" | "last_month" | "last_3_months";

export const PERIOD_LABELS: Record<MileagePeriod, string> = {
  this_month: "This month",
  last_month: "Last month",
  last_3_months: "Last 3 months",
};

/** India dates for a period, inclusive. */
export function periodRange(period: MileagePeriod, today = todayInIst()): { from: string; to: string } {
  const monthStart = `${today.slice(0, 7)}-01`;
  if (period === "this_month") return { from: monthStart, to: today };
  const lastMonthEnd = shiftDate(monthStart, -1);
  if (period === "last_month") return { from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd };
  const [year, month] = monthStart.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 3, 1));
  return { from: start.toISOString().slice(0, 10), to: today };
}

/** Text for "Send on WhatsApp". */
export function mileageAlertWhatsApp(input: { company: string; busNumber: string; alert: MileageAlert }): string {
  const { alert } = input;
  return [
    `*${input.company} · Mileage ${alert.level === "alert" ? "alert" : "check"}*`,
    `🚌 ${input.busNumber}`,
    alert.title,
    alert.advice,
  ].join("\n");
}
