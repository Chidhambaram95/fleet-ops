export type TripStatus = "draft" | "approved";
export type PaidBy = "cash" | "credit";

export type TripExpenseCategory =
  | "pooja"
  | "driver_bata"
  | "cleaner_bata"
  | "toll"
  | "halt_bata"
  | "rto"
  | "adblue"
  | "police"
  | "parking"
  | "tyre"
  | "mechanic"
  | "seat_wash"
  | "grease"
  | "interstate_permit"
  | "guide_commission"
  | "other";

/** One diesel fill on a trip sheet. Credit fills are paid later by the office. */
export type DieselFill = {
  litres: number | null;
  amountInr: number;
  paidBy: PaidBy;
  pump: string;
};

/** One cash expense line on a trip sheet. */
export type TripExpense = {
  category: TripExpenseCategory;
  amountInr: number;
  note: string;
};

/** One round trip, as recorded from the driver's trip sheet. */
export type Trip = {
  id: string;
  busId: string;
  sheetNo: string;
  route: string;
  /** ISO timestamps. */
  startedAt: string | null;
  endedAt: string | null;
  haltNote: string;
  driver1: string;
  driver2: string;
  cleaner: string;
  startKm: number | null;
  endKm: number | null;
  advanceInr: number;
  /** The total written on the sheet, kept to check the sums. */
  writtenTotalInr: number | null;
  photoPath: string;
  status: TripStatus;
  approvedAt: string | null;
  /** The day the advance balance was paid to or returned by the driver. */
  settledOn: string | null;
  diesel: DieselFill[];
  expenses: TripExpense[];
};

/** Trip list row: totals are worked out from the trip's lines. */
export type TripSummary = Omit<Trip, "diesel" | "expenses"> & {
  dieselLitres: number;
  dieselInr: number;
  cashSpentInr: number;
};
