import type { SupabaseClient } from "@supabase/supabase-js";
import { shareInFlight } from "@data/supabase/inflight";
import { throwIfError } from "@data/supabase/errors";
import { insertRow, listRows, num, str, type DateRange } from "@data/supabase/rows";
import type { CrewJob, CrewPerson, SalaryPayment } from "@domain/crew/types";
import { isModuleId, type ModuleId } from "@domain/modules/modules";

type Row = Record<string, unknown>;
const mod = (value: unknown, fallback: ModuleId): ModuleId => (isModuleId(value) ? value : fallback);

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

// Crew people and salaries

export function listCrewPeople(client: SupabaseClient, organizationId: string): Promise<CrewPerson[]> {
  return shareInFlight(`crew-people:${organizationId}`, () => fetchCrewPeople(client, organizationId));
}

async function fetchCrewPeople(
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
  range?: DateRange,
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

