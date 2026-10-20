import type { TripExpenseCategory } from "./types";

/** In the order they appear on the printed trip sheet. */
export const TRIP_EXPENSE_CATEGORIES: { id: TripExpenseCategory; label: string }[] = [
  { id: "pooja", label: "Pooja" },
  { id: "driver_bata", label: "Driver bata" },
  { id: "cleaner_bata", label: "Cleaner bata" },
  { id: "toll", label: "Toll" },
  { id: "halt_bata", label: "Halt bata" },
  { id: "rto", label: "RTO" },
  { id: "adblue", label: "AdBlue" },
  { id: "police", label: "Police (PC)" },
  { id: "parking", label: "Parking" },
  { id: "tyre", label: "Tyre" },
  { id: "mechanic", label: "Mechanic" },
  { id: "seat_wash", label: "Seat cover wash" },
  { id: "grease", label: "Grease" },
  { id: "other", label: "Other" },
];

export const TRIP_EXPENSE_IDS = TRIP_EXPENSE_CATEGORIES.map((item) => item.id) as [
  TripExpenseCategory,
  ...TripExpenseCategory[],
];

export function tripExpenseLabel(category: string): string {
  return TRIP_EXPENSE_CATEGORIES.find((item) => item.id === category)?.label ?? category;
}
