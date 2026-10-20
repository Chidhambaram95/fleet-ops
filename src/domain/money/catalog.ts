import type { CompanyExpenseCategory, PaidVia } from "./types";

export const COMPANY_EXPENSE_CATEGORIES: { id: CompanyExpenseCategory; label: string }[] = [
  { id: "accident_repair", label: "Accident repair" },
  { id: "workshop", label: "Workshop bill" },
  { id: "tyre_retread", label: "Tyre / retread" },
  { id: "new_purchase", label: "New purchase" },
  { id: "manager_salary", label: "Manager salary" },
  { id: "auditor", label: "Auditor" },
  { id: "office", label: "Office" },
  { id: "loan_emi", label: "Loan EMI" },
  { id: "other", label: "Other" },
];

export const PAID_VIA: { id: PaidVia; label: string }[] = [
  { id: "bank", label: "Bank" },
  { id: "upi", label: "UPI" },
  { id: "cash", label: "Cash" },
];

export function companyExpenseLabel(category: string): string {
  return COMPANY_EXPENSE_CATEGORIES.find((item) => item.id === category)?.label ?? category;
}

/** Pump names are typed by hand; compare them without case or extra spaces. */
export function pumpKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
