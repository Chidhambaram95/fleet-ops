import type { Renewal, RenewalKind } from "./types";

export const BUS_DOCUMENTS: { id: RenewalKind; label: string }[] = [
  { id: "fc", label: "FC (fitness)" },
  { id: "insurance", label: "Insurance" },
  { id: "permit", label: "Permit" },
  { id: "road_tax", label: "Road tax" },
  { id: "puc", label: "PUC" },
  { id: "speed_governor", label: "Speed governor" },
  { id: "gps", label: "GPS" },
];

export const DRIVER_DOCUMENTS: { id: RenewalKind; label: string }[] = [
  { id: "licence", label: "Driving licence" },
  { id: "badge", label: "Badge" },
];

export function renewalLabel(kind: string): string {
  return (
    [...BUS_DOCUMENTS, ...DRIVER_DOCUMENTS].find((item) => item.id === kind)?.label ?? kind
  );
}

export function isDriverDocument(kind: RenewalKind): boolean {
  return kind === "licence" || kind === "badge";
}

/** Whole days from today to the expiry date; negative once expired. Dates are YYYY-MM-DD in IST. */
export function daysLeft(expiresOn: string, today: string): number {
  const toUtc = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(expiresOn) - toUtc(today)) / 86_400_000);
}

export type DueStatus = "expired" | "due" | "soon" | "ok";

/** expired: past the date; due: within 7 days; soon: within 30 days. */
export function dueStatus(days: number): DueStatus {
  if (days < 0) return "expired";
  if (days <= 7) return "due";
  if (days <= 30) return "soon";
  return "ok";
}

export function dueText(days: number): string {
  if (days < 0) return `Expired ${-days} day${days === -1 ? "" : "s"} ago`;
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `${days} days left`;
}

/** The latest renewal of each document for each bus or driver. */
export function currentRenewals(renewals: Renewal[]): Renewal[] {
  const latest = new Map<string, Renewal>();
  for (const renewal of renewals) {
    const key = `${renewal.busId ?? renewal.personId}:${renewal.kind}`;
    const found = latest.get(key);
    if (!found || renewal.expiresOn > found.expiresOn) {
      latest.set(key, renewal);
    }
  }
  return [...latest.values()].sort((left, right) => left.expiresOn.localeCompare(right.expiresOn));
}

/** Reminders go out 30, 15 and 7 days before, and on the day. */
export const REMINDER_DAYS = [30, 15, 7, 0];

export function reminderText(items: { owner: string; kind: RenewalKind; expiresOn: string; days: number }[]): string {
  const lines = items.map(
    (item) => `• ${item.owner}: ${renewalLabel(item.kind)} – ${item.expiresOn.split("-").reverse().join("-")} (${dueText(item.days)})`,
  );
  return [`*Renewals due*`, ...lines].join("\n");
}
