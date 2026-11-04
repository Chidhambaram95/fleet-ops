import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_REMINDER_DAYS, type EmiStatus, type Loan, type LoanEmi } from "@domain/loans/emis";

type Row = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : "");
const dateOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);

const MISSING_0027 = /(bus_loans|loan_emis|emi_reminder_days).*(does not exist|schema cache)|(does not exist|schema cache).*(bus_loans|loan_emis|emi_reminder_days)/;

function throwIfError(error: { message: string } | null) {
  if (!error) return;
  if (MISSING_0027.test(error.message)) {
    throw new Error("Run migration 0027 on the database to track loans and EMIs.");
  }
  throw new Error(error.message);
}

function toLoan(row: Row): Loan {
  return {
    id: str(row.id),
    busIds: Array.isArray(row.bus_ids) ? row.bus_ids.map(String) : [],
    lender: str(row.lender),
    loanRef: str(row.loan_ref),
    debitAccount: str(row.debit_account),
    emiInr: Number(row.emi_inr ?? 0),
    sweepDay: Number(row.sweep_day ?? 1),
    firstMonth: str(row.first_month),
    lastMonth: str(row.last_month),
    note: str(row.note),
  };
}

function toEmi(row: Row): LoanEmi {
  return {
    id: str(row.id),
    loanId: str(row.loan_id),
    dueMonth: str(row.due_month),
    status: (["due", "missed", "funds_added", "cleared"].includes(str(row.status)) ? row.status : "due") as EmiStatus,
    amountInr: Number(row.amount_inr ?? 0),
    fundsAddedOn: dateOrNull(row.funds_added_on),
    retryOn: dateOrNull(row.retry_on),
    clearedOn: dateOrNull(row.cleared_on),
    feeInr: Number(row.fee_inr ?? 0),
    fineInr: Number(row.fine_inr ?? 0),
    note: str(row.note),
    expenseId: dateOrNull(row.expense_id),
  };
}

/** Loans and EMI records. Empty, without an error, before migration 0027. */
export async function listLoans(
  client: SupabaseClient,
  organizationId: string,
  { quiet = false }: { quiet?: boolean } = {},
): Promise<{ loans: Loan[]; emis: LoanEmi[] }> {
  const [loans, emis] = await Promise.all([
    client.from("bus_loans").select("*").eq("organization_id", organizationId).order("created_at").limit(500),
    client.from("loan_emis").select("*").eq("organization_id", organizationId).order("due_month").limit(5000),
  ]);
  const error = loans.error ?? emis.error;
  if (error) {
    if (quiet || MISSING_0027.test(error.message)) return { loans: [], emis: [] };
    throwIfError(error);
  }
  return { loans: ((loans.data ?? []) as Row[]).map(toLoan), emis: ((emis.data ?? []) as Row[]).map(toEmi) };
}

export type LoanInput = Omit<Loan, "id">;

export async function saveLoan(client: SupabaseClient, organizationId: string, input: LoanInput, id?: string) {
  const row = {
    organization_id: organizationId,
    bus_ids: input.busIds,
    lender: input.lender.trim(),
    loan_ref: input.loanRef.trim(),
    debit_account: input.debitAccount.trim(),
    emi_inr: input.emiInr,
    sweep_day: input.sweepDay,
    first_month: input.firstMonth,
    last_month: input.lastMonth,
    note: input.note.trim(),
  };
  const { error } = id
    ? await client.from("bus_loans").update(row).eq("organization_id", organizationId).eq("id", id)
    : await client.from("bus_loans").insert(row);
  throwIfError(error);
}

export async function deleteLoan(client: SupabaseClient, organizationId: string, id: string) {
  const { error } = await client.from("bus_loans").delete().eq("organization_id", organizationId).eq("id", id);
  throwIfError(error);
}

export type EmiInput = {
  loanId: string;
  dueMonth: string;
  status: EmiStatus;
  amountInr: number;
  fundsAddedOn: string | null;
  retryOn: string | null;
  clearedOn: string | null;
  feeInr: number;
  fineInr: number;
  note: string;
};

/** Saves one month's EMI (one record per loan and month). */
export async function saveEmi(client: SupabaseClient, organizationId: string, input: EmiInput) {
  const { error } = await client.from("loan_emis").upsert(
    {
      organization_id: organizationId,
      loan_id: input.loanId,
      due_month: input.dueMonth,
      status: input.status,
      amount_inr: input.amountInr,
      funds_added_on: input.fundsAddedOn,
      retry_on: input.retryOn,
      cleared_on: input.status === "cleared" ? input.clearedOn : null,
      fee_inr: input.feeInr,
      fine_inr: input.fineInr,
      note: input.note.trim(),
    },
    { onConflict: "loan_id,due_month" },
  );
  throwIfError(error);
}

/** Back to plain "due": removes the month's record and any costs it added. */
export async function resetEmi(client: SupabaseClient, organizationId: string, id: string) {
  const { error } = await client.from("loan_emis").delete().eq("organization_id", organizationId).eq("id", id);
  throwIfError(error);
}

export async function getEmiReminderDays(client: SupabaseClient, organizationId: string): Promise<number> {
  const { data, error } = await client
    .from("organizations")
    .select("emi_reminder_days")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data) return DEFAULT_REMINDER_DAYS;
  const days = Number((data as Row).emi_reminder_days);
  return Number.isInteger(days) && days >= 1 && days <= 10 ? days : DEFAULT_REMINDER_DAYS;
}

export async function saveEmiReminderDays(client: SupabaseClient, organizationId: string, days: number) {
  const { data, error } = await client
    .from("organizations")
    .update({ emi_reminder_days: days })
    .eq("id", organizationId)
    .select("id");
  throwIfError(error);
  if (!data?.length) throw new Error("Only admins can change the reminder days.");
}
