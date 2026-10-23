import type { TyreEventKind, TyreStatus } from "./types";

/** The six road wheels of a bus, as seen from above with the front at the top. */
export const ROAD_POSITIONS = [
  { id: "front_left", label: "Front left", short: "FL" },
  { id: "front_right", label: "Front right", short: "FR" },
  { id: "rear_left_outer", label: "Rear left outer", short: "RLO" },
  { id: "rear_left_inner", label: "Rear left inner", short: "RLI" },
  { id: "rear_right_inner", label: "Rear right inner", short: "RRI" },
  { id: "rear_right_outer", label: "Rear right outer", short: "RRO" },
] as const;

export function sparePosition(number: number) {
  return `spare_${number}`;
}

export function isSpare(position: string | null | undefined) {
  return !!position && /^spare_\d+$/.test(position);
}

export function positionLabel(position: string | null | undefined): string {
  if (!position) return "";
  const road = ROAD_POSITIONS.find((item) => item.id === position);
  if (road) return road.label;
  const spare = /^spare_(\d+)$/.exec(position);
  if (spare) return spare[1] === "1" ? "Spare" : `Spare ${spare[1]}`;
  return position;
}

/** Spare spots to show for a bus: one more than the highest in use, and at least one. */
export function spareCount(positionsInUse: (string | null)[], extra = 0): number {
  const highest = positionsInUse.reduce((max, position) => {
    const match = position ? /^spare_(\d+)$/.exec(position) : null;
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return Math.max(1, highest) + extra;
}

export const STATUS_LABELS: Record<TyreStatus, string> = {
  in_stock: "In stock",
  fitted: "Fitted",
  at_retreader: "At retreader",
  scrapped: "Scrapped",
};

export const EVENT_LABELS: Record<TyreEventKind, string> = {
  fitted: "Fitted",
  rotated: "Rotated",
  removed: "Removed",
  sent_for_retread: "Sent for retread",
  retread_received: "Back from retread",
  repair: "Repair",
  scrapped: "Scrapped",
};

export const REMOVAL_REASONS = [
  "Worn out, for retread",
  "Puncture",
  "Rotation / moved to another bus",
  "Cut or damage",
  "Warranty claim",
  "Other",
];
