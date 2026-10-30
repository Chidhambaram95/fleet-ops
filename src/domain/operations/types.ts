export type EntryKind = "income" | "expense";

export type IncomeCategory =
  | "ticket_collection"
  | "private_hire"
  | "parcel"
  | "other";

export type ExpenseCategory =
  | "diesel"
  | "adblue"
  | "toll"
  | "crew_bata"
  | "police"
  | "parking"
  | "repair"
  | "other";

export type BusKind = "town" | "omni" | "tour";
export type SeatLayout = "" | "seater" | "sleeper";

export type Bus = {
  id: string;
  registrationNumber: string;
  routeLabel: string;
  busType: BusKind;
  seats: number | null;
  seatLayout: SeatLayout;
  permitType: string;
  runsWith: string;
};

export type NewBus = {
  registrationNumber: string;
  /** Town buses need a route; Omni and Tour buses can leave it empty. */
  routeLabel: string;
  busType?: BusKind;
  seats?: number | null;
  seatLayout?: SeatLayout;
  permitType?: string;
  runsWith?: string;
};

export type DailyEntry = {
  id: string;
  busId: string;
  date: string;
  kind: EntryKind;
  category: IncomeCategory | ExpenseCategory;
  amountInr: number;
  note: string;
  createdAt: string;
  /** Diesel only, for mileage: litres put in, odometer, and whether the tank was filled to full. */
  litres?: number | null;
  odometerKm?: number | null;
  fullTank?: boolean;
};

export type NewDailyEntry = Omit<DailyEntry, "id" | "createdAt">;

export type DayTotals = {
  incomeInr: number;
  expenseInr: number;
  netInr: number;
};
