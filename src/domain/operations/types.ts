export type EntryKind = "income" | "expense";

export type IncomeCategory =
  | "ticket_collection"
  | "private_hire"
  | "parcel"
  | "other";

export type ExpenseCategory =
  | "diesel"
  | "toll"
  | "crew_bata"
  | "parking"
  | "repair"
  | "other";

export type Bus = {
  id: string;
  registrationNumber: string;
  routeLabel: string;
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
};

export type NewDailyEntry = Omit<DailyEntry, "id" | "createdAt">;

export type DayTotals = {
  incomeInr: number;
  expenseInr: number;
  netInr: number;
};
