import { formatInr } from "@domain/operations/totals";
import type { HistoryRow } from "./types";

const RECORD_LABELS: Record<string, string> = {
  daily_entries: "Cash entry",
  trips: "Trip sheet",
  pump_statements: "Pump statement",
  pump_payments: "Pump payment",
  company_expenses: "Company cost",
  crew_people: "Staff record",
  salary_payments: "Salary payment",
  intercity_income: "Intercity income",
  renewals: "Renewal",
  tour_bookings: "Tour booking",
  tour_payments: "Tour payment",
};

const ACTION_LABELS: Record<HistoryRow["action"], string> = {
  insert: "added",
  update: "changed",
  delete: "deleted",
};

/** Fields that change on their own or mean nothing to people. */
const HIDDEN_FIELDS = new Set([
  "id",
  "organization_id",
  "created_at",
  "updated_at",
  "created_by",
  "approved_by",
  "photo_path",
  "bus_id",
  "bus_ids",
  "person_id",
  "booking_id",
  "trip_id",
  "items",
]);

const FIELD_LABELS: Record<string, string> = {
  amount_inr: "Amount",
  entry_date: "Date",
  spent_on: "Date",
  paid_on: "Paid on",
  received_on: "Received on",
  statement_on: "Statement date",
  outstanding_inr: "Outstanding",
  monthly_salary_inr: "Monthly salary",
  advance_inr: "Advance",
  written_total_inr: "Written total",
  hire_amount_inr: "Hire amount",
  advance_required_inr: "Advance needed",
  start_km: "Start km",
  end_km: "End km",
  sheet_no: "Sheet no.",
  settled_on: "Settled on",
  expires_on: "Expires on",
  for_month: "For month",
  customer_name: "Customer",
  paid_via: "Paid via",
};

export function recordLabel(table: string) {
  return RECORD_LABELS[table] ?? table.replace(/_/g, " ");
}

export function fieldLabel(field: string) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const words = field.replace(/_inr$/, "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "blank";
  if (field.endsWith("_inr") && typeof value === "number") return formatInr(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).replace(/_/g, " ");
}

/** "Cash entry added", with the amount when there is one. */
export function changeTitle(row: HistoryRow) {
  const data = row.newData ?? row.oldData ?? {};
  const amount = typeof data.amount_inr === "number" ? ` · ${formatInr(data.amount_inr)}` : "";
  return `${recordLabel(row.table)} ${ACTION_LABELS[row.action]}${amount}`;
}

/** What changed, one line per field: "Amount: ₹2,000 → ₹2,500". */
export function changedFields(row: HistoryRow): string[] {
  if (row.action !== "update" || !row.oldData || !row.newData) return [];
  const lines: string[] = [];
  for (const field of Object.keys(row.newData)) {
    if (HIDDEN_FIELDS.has(field)) continue;
    const before = row.oldData[field];
    const after = row.newData[field];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    lines.push(`${fieldLabel(field)}: ${show(field, before)} → ${show(field, after)}`);
  }
  // Trip lines are compared as a whole.
  if (JSON.stringify(row.oldData.items ?? null) !== JSON.stringify(row.newData.items ?? null)) {
    lines.push("Trip lines changed");
  }
  return lines;
}

/** "Ravi" or "Fleet Ops support" or "Someone". */
export function changedByLabel(row: HistoryRow) {
  if (row.changedByName) return row.changedByName;
  return row.changedBy ? "Someone in the team" : "Fleet Ops support";
}

/** "23 Oct, 4:05 pm" in India time. */
export function changedAtLabel(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}
