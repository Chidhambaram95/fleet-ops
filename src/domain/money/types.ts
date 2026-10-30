import type { ModuleId } from "@domain/modules/modules";

export type CompanyExpenseCategory =
  | "accident_repair"
  | "workshop"
  | "tyre_retread"
  | "new_purchase"
  | "manager_salary"
  | "auditor"
  | "office"
  | "loan_emi"
  | "other";

export type PaidVia = "bank" | "upi" | "cash";

/** A cost paid from the bank or for the company. No buses picked means it is shared by every bus. */
export type CompanyExpense = {
  id: string;
  busIds: string[];
  spentOn: string;
  category: CompanyExpenseCategory;
  amountInr: number;
  paidVia: PaidVia;
  note: string;
};

export type PumpStatement = {
  id: string;
  pump: string;
  statementOn: string;
  outstandingInr: number;
  note: string;
  /** When it was entered; breaks ties between figures for the same date. */
  createdAt: string;
  module: ModuleId;
};

export type PumpPayment = {
  id: string;
  pump: string;
  paidOn: string;
  amountInr: number;
  reference: string;
  module: ModuleId;
};

export type CrewJob = "driver" | "conductor" | "cleaner";

export type CrewPerson = {
  id: string;
  name: string;
  job: CrewJob;
  phone: string;
  monthlySalaryInr: number;
  licenceNo: string;
  active: boolean;
  module: ModuleId;
};

export type SalaryPayment = {
  id: string;
  personId: string;
  /** YYYY-MM-01 */
  forMonth: string;
  paidOn: string;
  amountInr: number;
  note: string;
};

/** A fortnightly Intercity payment, shared across the buses it covers. */
export type IntercityIncome = {
  id: string;
  periodStart: string;
  periodEnd: string;
  receivedOn: string;
  amountInr: number;
  busIds: string[];
  note: string;
};
