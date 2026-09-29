import { z } from "zod";
import type { ExpenseCategory } from "./types";

export const RECEIPT_CATEGORIES = [
  "Diesel",
  "Toll",
  "Maintenance",
  "Batta",
  "Other",
] as const;

export const receiptSchema = z.object({
  amount: z.number().positive(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isCalendarDate, "Date must be a real YYYY-MM-DD day."),
  category: z.enum(RECEIPT_CATEGORIES),
  liters: z.number().positive().nullish(),
  vendorName: z.string().nullish(),
});

export type Receipt = z.infer<typeof receiptSchema>;

const categoryByReceipt: Record<
  (typeof RECEIPT_CATEGORIES)[number],
  ExpenseCategory
> = {
  Diesel: "diesel",
  Toll: "toll",
  Maintenance: "repair",
  Batta: "crew_bata",
  Other: "other",
};

export function expenseFromReceipt(receipt: Receipt): {
  category: ExpenseCategory;
  amount: string;
  note: string;
  date: string;
} {
  const vendor = receipt.vendorName?.trim() ?? "";
  const liters =
    receipt.liters != null && Number.isFinite(receipt.liters)
      ? `${receipt.liters} L`
      : "";

  return {
    category: categoryByReceipt[receipt.category],
    amount: String(Math.round(receipt.amount)),
    note: [vendor, liters].filter(Boolean).join(" · "),
    date: receipt.date,
  };
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
