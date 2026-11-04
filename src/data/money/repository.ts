import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CompanyExpense,
  CompanyExpenseCategory,
  CostAppliesTo,
  SpreadMonths,
  CrewJob,
  CrewPerson,
  IntercityIncome,
  PaidVia,
  PumpPayment,
  PumpStatement,
  SalaryPayment,
} from "@domain/money/types";
import { isModuleId, type ModuleId } from "@domain/modules/modules";

function throwIfError(error: { message: string } | null) {
  if (error) {
    throw new Error(error.message);
  }
}

type Range = { from?: string; to?: string };

/** Rows of one company, newest first, optionally between two dates (inclusive). */
async function listRows<Row>(
  client: SupabaseClient,
  table: string,
  organizationId: string,
  dateColumn: string,
  range: Range = {},
  limit = 500,
): Promise<Row[]> {
  let query = client.from(table).select("*").eq("organization_id", organizationId);
  if (range.from) query = query.gte(dateColumn, range.from);
  if (range.to) query = query.lte(dateColumn, range.to);
  const { data, error } = await query.order(dateColumn, { ascending: false }).limit(limit);
  throwIfError(error);
  return (data ?? []) as Row[];
}

async function insertRow(
  client: SupabaseClient,
  table: string,
  organizationId: string,
  values: Record<string, unknown>,
) {
  const { error } = await client
    .from(table)
    .insert({ organization_id: organizationId, ...values });
  throwIfError(error);
}

export async function deleteRow(
  client: SupabaseClient,
  table:
    | "company_expenses"
    | "pump_statements"
    | "pump_payments"
    | "salary_payments"
    | "intercity_income"
    | "crew_people"
    | "renewals",
  organizationId: string,
  id: string,
) {
  const { error } = await client
    .from(table)
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", id);
  throwIfError(error);
}

type Row = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0));
const mod = (value: unknown, fallback: ModuleId): ModuleId => (isModuleId(value) ? value : fallback);
const ids = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

// Company and bank costs

export async function listCompanyExpenses(
  client: SupabaseClient,
  organizationId: string,
  range?: Range,
): Promise<CompanyExpense[]> {
  const rows = await listRows<Row>(client, "company_expenses", organizationId, "spent_on", range, 3000);
  return rows.map((row) => {
    const busIds = ids(row.bus_ids).length ? ids(row.bus_ids) : typeof row.bus_id === "string" ? [row.bus_id] : [];
    // Before migration 0025 there is no applies_to: picked buses, or all buses.
    const appliesType = isModuleId(row.applies_type) ? row.applies_type : null;
    const appliesTo: CostAppliesTo =
      row.applies_to === "type" && appliesType ? "type" : busIds.length ? "buses" : "all";
    return {
      id: str(row.id),
      appliesTo,
      appliesType: appliesTo === "type" ? appliesType : null,
      busIds: appliesTo === "buses" ? busIds : [],
      spentOn: str(row.spent_on),
      category: str(row.category) as CompanyExpenseCategory,
      amountInr: num(row.amount_inr),
      paidVia: (str(row.paid_via) || "bank") as PaidVia,
      note: str(row.note),
      // Before migration 0026 there is no spread or repeat.
      spreadMonths: toSpread(row.spread_months),
      repeatMonthly: row.repeat_monthly === true,
    };
  });
}

const toSpread = (value: unknown): SpreadMonths => {
  const months = num(value);
  return months === 3 || months === 6 || months === 12 ? months : 1;
};

/** Spread and repeat columns, left out when they are the defaults so older databases still save. */
function extraColumns(input: Pick<CompanyExpense, "spreadMonths" | "repeatMonthly">) {
  return {
    ...(input.spreadMonths !== 1 ? { spread_months: input.spreadMonths } : {}),
    ...(input.repeatMonthly ? { repeat_monthly: true } : {}),
  };
}

const MISSING_0026 = /spread_months|repeat_monthly|insurance|permit_tax|company_expenses_category_check/;

/** Changes a saved cost: what for, amount, date, who it applies to, spread and repeat. */
export async function updateCompanyExpense(
  client: SupabaseClient,
  organizationId: string,
  id: string,
  input: Omit<CompanyExpense, "id">,
) {
  const { error } = await client
    .from("company_expenses")
    .update({
      spent_on: input.spentOn,
      category: input.category,
      amount_inr: input.amountInr,
      paid_via: input.paidVia,
      note: input.note,
      applies_to: input.appliesTo,
      applies_type: input.appliesTo === "type" ? input.appliesType : null,
      bus_ids: input.appliesTo === "buses" ? input.busIds : [],
      spread_months: input.spreadMonths,
      repeat_monthly: input.repeatMonthly,
    })
    .eq("organization_id", organizationId)
    .eq("id", id);
  if (error && MISSING_0026.test(error.message)) {
    throw new Error("Run migration 0026 on the database to edit costs, spread them over months or repeat them.");
  }
  throwIfError(error);
}

/**
 * Saves a cost. `typeBusIds` are the buses of the picked type today, used
 * only if the database doesn't have migration 0025 yet (then a type cost is
 * saved as those buses).
 */
export async function addCompanyExpense(
  client: SupabaseClient,
  organizationId: string,
  input: Omit<CompanyExpense, "id">,
  typeBusIds: string[] = [],
) {
  const base = {
    spent_on: input.spentOn,
    category: input.category,
    amount_inr: input.amountInr,
    paid_via: input.paidVia,
    note: input.note,
  };
  const { error } = await client.from("company_expenses").insert({
    organization_id: organizationId,
    ...base,
    applies_to: input.appliesTo,
    applies_type: input.appliesTo === "type" ? input.appliesType : null,
    bus_ids: input.appliesTo === "buses" ? input.busIds : [],
    ...extraColumns(input),
  });
  if (error && MISSING_0026.test(error.message)) {
    throw new Error("Run migration 0026 on the database to spread costs, repeat them or use the Insurance and Permit categories.");
  }
  if (error && /applies_(to|type)/.test(error.message)) {
    return insertRow(client, "company_expenses", organizationId, {
      ...base,
      bus_ids: input.appliesTo === "buses" ? input.busIds : input.appliesTo === "type" ? typeBusIds : [],
    });
  }
  throwIfError(error);
}

/** Town day crew between two dates: who worked which bus each day. Empty before migration 0023. */
export async function listDayCrewBetween(
  client: SupabaseClient,
  organizationId: string,
  range: { from: string; to: string },
): Promise<{ busId: string; date: string; personId: string }[]> {
  const { data, error } = await client
    .from("day_crew")
    .select("bus_id, day, person_id")
    .eq("organization_id", organizationId)
    .gte("day", range.from)
    .lte("day", range.to)
    .limit(20000);
  if (error) return [];
  return ((data ?? []) as Row[]).map((row) => ({
    busId: str(row.bus_id),
    date: str(row.day),
    personId: str(row.person_id),
  }));
}

/** Odometer readings between two dates, for km on buses without trip sheets. Empty before migration 0022. */
export async function listOdometerReadings(
  client: SupabaseClient,
  organizationId: string,
  range: { from: string; to: string },
): Promise<{ busId: string; date: string; km: number }[]> {
  const { data, error } = await client
    .from("odometer_readings")
    .select("bus_id, reading_date, odometer_km")
    .eq("organization_id", organizationId)
    .gte("reading_date", range.from)
    .lte("reading_date", range.to)
    .limit(10000);
  if (error) return [];
  return ((data ?? []) as Row[]).map((row) => ({
    busId: str(row.bus_id),
    date: str(row.reading_date),
    km: num(row.odometer_km),
  }));
}

// Pumps

export async function listPumpStatements(
  client: SupabaseClient,
  organizationId: string,
): Promise<PumpStatement[]> {
  const rows = await listRows<Row>(client, "pump_statements", organizationId, "statement_on");
  return rows.map((row) => ({
    id: str(row.id),
    pump: str(row.pump),
    statementOn: str(row.statement_on),
    outstandingInr: num(row.outstanding_inr),
    note: str(row.note),
    createdAt: str(row.created_at),
    module: mod(row.module, "omni"),
  }));
}

export function addPumpStatement(
  client: SupabaseClient,
  organizationId: string,
  input: Omit<PumpStatement, "id" | "createdAt">,
) {
  return insertRow(client, "pump_statements", organizationId, {
    pump: input.pump,
    statement_on: input.statementOn,
    outstanding_inr: input.outstandingInr,
    note: input.note,
    module: input.module,
  });
}

export async function listPumpPayments(
  client: SupabaseClient,
  organizationId: string,
): Promise<PumpPayment[]> {
  const rows = await listRows<Row>(client, "pump_payments", organizationId, "paid_on");
  return rows.map((row) => ({
    id: str(row.id),
    pump: str(row.pump),
    paidOn: str(row.paid_on),
    amountInr: num(row.amount_inr),
    reference: str(row.reference),
    module: mod(row.module, "omni"),
  }));
}

export function addPumpPayment(
  client: SupabaseClient,
  organizationId: string,
  input: Omit<PumpPayment, "id">,
) {
  return insertRow(client, "pump_payments", organizationId, {
    pump: input.pump,
    paid_on: input.paidOn,
    amount_inr: input.amountInr,
    reference: input.reference,
    module: input.module,
  });
}

// Crew and salaries

export async function listCrewPeople(
  client: SupabaseClient,
  organizationId: string,
): Promise<CrewPerson[]> {
  const { data, error } = await client
    .from("crew_people")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  throwIfError(error);
  return ((data ?? []) as Row[]).map((row) => ({
    id: str(row.id),
    name: str(row.name),
    job: (str(row.job) || "driver") as CrewJob,
    phone: str(row.phone),
    monthlySalaryInr: num(row.monthly_salary_inr),
    licenceNo: str(row.licence_no),
    active: row.active !== false,
    module: mod(row.module, "town"),
  }));
}

function personColumns(input: Omit<CrewPerson, "id">) {
  return {
    name: input.name,
    job: input.job,
    phone: input.phone,
    monthly_salary_inr: input.monthlySalaryInr,
    licence_no: input.licenceNo,
    active: input.active,
    module: input.module,
  };
}

export function addCrewPerson(
  client: SupabaseClient,
  organizationId: string,
  input: Omit<CrewPerson, "id">,
) {
  return insertRow(client, "crew_people", organizationId, personColumns(input));
}

export async function updateCrewPerson(
  client: SupabaseClient,
  organizationId: string,
  id: string,
  input: Omit<CrewPerson, "id">,
) {
  const { error } = await client
    .from("crew_people")
    .update(personColumns(input))
    .eq("organization_id", organizationId)
    .eq("id", id);
  throwIfError(error);
}

export async function listSalaryPayments(
  client: SupabaseClient,
  organizationId: string,
  range?: Range,
): Promise<SalaryPayment[]> {
  const rows = await listRows<Row>(client, "salary_payments", organizationId, "for_month", range, 2000);
  return rows.map((row) => ({
    id: str(row.id),
    personId: str(row.person_id),
    forMonth: str(row.for_month),
    paidOn: str(row.paid_on),
    amountInr: num(row.amount_inr),
    note: str(row.note),
  }));
}

export function addSalaryPayment(
  client: SupabaseClient,
  organizationId: string,
  input: Omit<SalaryPayment, "id">,
) {
  return insertRow(client, "salary_payments", organizationId, {
    person_id: input.personId,
    for_month: input.forMonth,
    paid_on: input.paidOn,
    amount_inr: input.amountInr,
    note: input.note,
  });
}

// Intercity

export async function listIntercityIncome(
  client: SupabaseClient,
  organizationId: string,
  range?: Range,
): Promise<IntercityIncome[]> {
  const rows = await listRows<Row>(client, "intercity_income", organizationId, "received_on", range);
  return rows.map((row) => ({
    id: str(row.id),
    periodStart: str(row.period_start),
    periodEnd: str(row.period_end),
    receivedOn: str(row.received_on),
    amountInr: num(row.amount_inr),
    busIds: Array.isArray(row.bus_ids) ? row.bus_ids.map(String) : [],
    note: str(row.note),
  }));
}

export function addIntercityIncome(
  client: SupabaseClient,
  organizationId: string,
  input: Omit<IntercityIncome, "id">,
) {
  return insertRow(client, "intercity_income", organizationId, {
    period_start: input.periodStart,
    period_end: input.periodEnd,
    received_on: input.receivedOn,
    amount_inr: input.amountInr,
    bus_ids: input.busIds,
    note: input.note,
  });
}

// Trip advances

export async function markTripSettled(
  client: SupabaseClient,
  organizationId: string,
  tripId: string,
  settledOn: string,
) {
  const { error } = await client
    .from("trips")
    .update({ settled_on: settledOn })
    .eq("organization_id", organizationId)
    .eq("id", tripId);
  throwIfError(error);
}
