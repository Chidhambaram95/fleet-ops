import type {
  Bus,
  DailyEntry,
  EntryKind,
  ExpenseCategory,
  IncomeCategory,
} from "@domain/operations/types";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@domain/operations/catalog";

const INCOME_IDS = new Set<string>(INCOME_CATEGORIES.map((item) => item.id));
const EXPENSE_IDS = new Set<string>(EXPENSE_CATEGORIES.map((item) => item.id));

export type BusRow = {
  id: string;
  registration_number: string;
  route_label: string;
};

export type DailyEntryRow = {
  id: string;
  bus_id: string;
  entry_date: string;
  kind: string;
  category: string;
  amount_inr: number;
  note: string | null;
  created_at: string;
};

export function mapBus(row: BusRow): Bus {
  return {
    id: row.id,
    registrationNumber: row.registration_number,
    routeLabel: row.route_label,
  };
}

function mapKind(kind: string): EntryKind {
  if (kind === "income" || kind === "expense") {
    return kind;
  }
  throw new Error(`Unknown entry kind: ${kind}`);
}

function mapCategory(
  kind: EntryKind,
  category: string,
): IncomeCategory | ExpenseCategory {
  if (kind === "income" && INCOME_IDS.has(category)) {
    return category as IncomeCategory;
  }
  if (kind === "expense" && EXPENSE_IDS.has(category)) {
    return category as ExpenseCategory;
  }
  throw new Error(`Unknown ${kind} category: ${category}`);
}

export function mapDailyEntry(row: DailyEntryRow): DailyEntry {
  const kind = mapKind(row.kind);
  const amountInr = Number(row.amount_inr);
  if (!Number.isInteger(amountInr) || amountInr <= 0) {
    throw new Error(`Invalid amount_inr: ${row.amount_inr}`);
  }

  return {
    id: row.id,
    busId: row.bus_id,
    date: row.entry_date,
    kind,
    category: mapCategory(kind, row.category),
    amountInr,
    note: row.note ?? "",
    createdAt: row.created_at,
  };
}
