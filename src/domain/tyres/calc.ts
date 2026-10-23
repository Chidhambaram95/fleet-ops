import { positionLabel } from "./catalog";
import type { Tyre, TyreEvent, TyreLifeSettings } from "./types";

/** Km run in the current stint, when a newer odometer for the bus is known. */
export function currentStintKm(tyre: Tyre, latestOdometerKm: number | null): number | null {
  if (tyre.status !== "fitted" || tyre.fittedOdometerKm == null || latestOdometerKm == null) return null;
  if (tyre.currentPosition?.startsWith("spare_")) return 0;
  return Math.max(0, latestOdometerKm - tyre.fittedOdometerKm);
}

/** Finished stints plus the current one so far. */
export function kmSoFar(tyre: Tyre, latestOdometerKm: number | null): number {
  return tyre.totalKm + (currentStintKm(tyre, latestOdometerKm) ?? 0);
}

/** Purchase plus every retread and repair bill. */
export function totalSpentInr(tyre: Tyre, events: TyreEvent[]): number {
  return (
    (tyre.purchasePriceInr ?? 0) +
    events
      .filter((event) => event.tyreId === tyre.id && (event.kind === "retread_received" || event.kind === "repair"))
      .reduce((total, event) => total + (event.costInr ?? 0), 0)
  );
}

/** Rupees per km, to two decimals, once the tyre has run. */
export function costPerKm(spentInr: number, km: number): number | null {
  return km > 0 ? Math.round((spentInr / km) * 100) / 100 : null;
}

/** The last day of the warranty by date: purchase date plus the months. */
export function warrantyEndsOn(tyre: Pick<Tyre, "purchaseDate" | "warrantyMonths">): string | null {
  if (!tyre.warrantyMonths || !/^\d{4}-\d{2}-\d{2}$/.test(tyre.purchaseDate)) return null;
  const [year, month, day] = tyre.purchaseDate.split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1 + tyre.warrantyMonths, day));
  // 31 Jan + 1 month is 28 or 29 Feb, not 3 Mar.
  if (end.getUTCDate() !== day) end.setUTCDate(0);
  return end.toISOString().slice(0, 10);
}

export type WarrantyState = "none" | "ok" | "ending" | "over";

/** Over once the date has passed or the km are used up; ending within 30 days or 10% of the km. */
export function warrantyState(tyre: Tyre, km: number, today: string): WarrantyState {
  const endsOn = warrantyEndsOn(tyre);
  if (!endsOn && !tyre.warrantyKm) return "none";
  if ((endsOn && endsOn < today) || (tyre.warrantyKm && km >= tyre.warrantyKm)) return "over";
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 30);
  if ((endsOn && endsOn <= soon.toISOString().slice(0, 10)) || (tyre.warrantyKm && km >= tyre.warrantyKm * 0.9)) {
    return "ending";
  }
  return "ok";
}

/** "Fitted on TN 38 AB 1234 · Front left", "In stock" and so on. */
export function whereNow(tyre: Tyre, busName: (id: string | null) => string): string {
  switch (tyre.status) {
    case "fitted":
      return `On ${busName(tyre.currentBusId)} · ${positionLabel(tyre.currentPosition)}`;
    case "at_retreader":
      return "At retreader";
    case "scrapped":
      return "Scrapped";
    default:
      return "In stock";
  }
}

/** Km each bus has run on this tyre, biggest first. */
export function kmByBus(events: TyreEvent[]): { busLabel: string; km: number }[] {
  const byBus = new Map<string, number>();
  for (const event of events) {
    if ((event.kind !== "removed" && event.kind !== "rotated") || event.kmRun == null) continue;
    byBus.set(event.busLabel, (byBus.get(event.busLabel) ?? 0) + event.kmRun);
  }
  return [...byBus.entries()]
    .map(([busLabel, km]) => ({ busLabel, km }))
    .sort((left, right) => right.km - left.km);
}

/**
 * One life of a tyre: from purchase, or from coming back from a retread,
 * until the next retread or scrap. Its cost is charged to the first bus it
 * goes on in that life.
 */
export type TyreLife = {
  /** 0 for the tyre as bought, then 1, 2 … per retread. */
  number: number;
  startedOn: string;
  costInr: number;
  /** The bus that paid this life's cost, or empty while it waits for one. */
  chargedTo: string;
  chargedOn: string | null;
  km: number;
  buses: string[];
  ended: boolean;
};

export function tyreLives(tyre: Tyre, events: TyreEvent[]): TyreLife[] {
  const lives: TyreLife[] = [];
  const start = (number: number, startedOn: string, costInr: number) => {
    lives.push({ number, startedOn, costInr, chargedTo: "", chargedOn: null, km: 0, buses: [], ended: false });
  };
  start(0, tyre.purchaseDate, tyre.purchasePriceInr ?? 0);
  for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
    const life = lives[lives.length - 1];
    switch (event.kind) {
      case "fitted":
        if (!life.chargedTo && event.chargeInr > 0) {
          life.chargedTo = event.busLabel;
          life.chargedOn = event.eventDate;
        }
        if (!life.buses.includes(event.busLabel)) life.buses.push(event.busLabel);
        break;
      case "removed":
      case "rotated":
        life.km += event.kmRun ?? 0;
        break;
      case "sent_for_retread":
      case "scrapped":
        life.ended = true;
        break;
      case "retread_received":
        life.ended = true;
        start(life.number + 1, event.eventDate, event.costInr ?? 0);
        break;
      case "repair":
        break;
    }
  }
  return lives;
}

/** Tyre money each bus was charged in the events given: purchases, retreads and repairs. */
export function chargesByBus(events: TyreEvent[]): Map<string, number> {
  const byBus = new Map<string, number>();
  for (const event of events) {
    if (!event.busId || !event.chargeInr) continue;
    byBus.set(event.busId, (byBus.get(event.busId) ?? 0) + event.chargeInr);
  }
  return byBus;
}

export function kmText(km: number) {
  return `${km.toLocaleString("en-IN")} km`;
}

/** Km this tyre should run in its current life: its warranty km, else the company default. */
export function expectedLifeKm(tyre: Tyre, settings: TyreLifeSettings): number {
  return tyre.lifeLimitKm ?? (tyre.retreadCount > 0 ? settings.retreadLifeKm : settings.newLifeKm);
}

/** Km in the current life, including the current stint so far. */
export function lifeKmSoFar(tyre: Tyre, latestOdometerKm: number | null): number {
  return tyre.lifeKm + (currentStintKm(tyre, latestOdometerKm) ?? 0);
}

export type TyreHealth = "good" | "watch" | "replace";

/** Good below 70% of the expected km, watch from 70%, replace soon from 90%. */
export function tyreHealth(lifeKm: number, expectedKm: number): { health: TyreHealth; percent: number } {
  const percent = expectedKm > 0 ? Math.round((lifeKm / expectedKm) * 100) : 0;
  return { health: percent >= 90 ? "replace" : percent >= 70 ? "watch" : "good", percent };
}

export const HEALTH_LABELS: Record<TyreHealth, string> = {
  good: "Good",
  watch: "Watch",
  replace: "Replace soon",
};

/** "42.4k km" for the small labels under a tyre. */
export function shortKm(km: number) {
  return km >= 1000 ? `${(Math.round(km / 100) / 10).toLocaleString("en-IN")}k km` : `${km} km`;
}
