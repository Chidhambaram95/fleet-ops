import type { ExpenseCategory, IncomeCategory } from "./types";

export const INCOME_CATEGORIES: { id: IncomeCategory; label: string }[] = [
  { id: "ticket_collection", label: "Tickets" },
  { id: "private_hire", label: "Hire" },
  { id: "parcel", label: "Parcel" },
  { id: "other", label: "Other" },
];

export const EXPENSE_CATEGORIES: { id: ExpenseCategory; label: string }[] = [
  { id: "diesel", label: "Diesel" },
  { id: "toll", label: "Toll" },
  { id: "crew_bata", label: "Crew bata" },
  { id: "parking", label: "Parking" },
  { id: "repair", label: "Repair" },
  { id: "other", label: "Other" },
];

export function categoryLabel(
  kind: "income" | "expense",
  category: string,
): string {
  const list = kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  return list.find((item) => item.id === category)?.label ?? category;
}
