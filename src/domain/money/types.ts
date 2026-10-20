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

/** A cost paid from the bank or for the whole company. No bus means "Company". */
export type CompanyExpense = {
  id: string;
  busId: string | null;
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
};

export type PumpPayment = {
  id: string;
  pump: string;
  paidOn: string;
  amountInr: number;
  reference: string;
};

export type CrewJob = "driver" | "cleaner";

export type CrewPerson = {
  id: string;
  name: string;
  job: CrewJob;
  phone: string;
  monthlySalaryInr: number;
  licenceNo: string;
  active: boolean;
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
