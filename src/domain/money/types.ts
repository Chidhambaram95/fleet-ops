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
  | "insurance"
  | "permit_tax"
  | "bank_fees"
  | "other";

export type PaidVia = "bank" | "upi" | "cash";

/**
 * Who a company cost is shared by: every bus, every bus of one type (buses
 * added later included), or the buses picked.
 */
export type CostAppliesTo = "all" | "type" | "buses";

/** A cost paid from the bank or for the company. */
export type CompanyExpense = {
  id: string;
  appliesTo: CostAppliesTo;
  /** Set only when appliesTo is "type". */
  appliesType: ModuleId | null;
  /** The picked buses when appliesTo is "buses"; empty otherwise. */
  busIds: string[];
  spentOn: string;
  category: CompanyExpenseCategory;
  amountInr: number;
  paidVia: PaidVia;
  note: string;
  /**
   * Months the cost is spread over in reports, from the month it was paid:
   * 1, 3, 6 or 12. Each month's part is spread day by day.
   */
  spreadMonths: SpreadMonths;
  /** Offered again every month on the costs screen (EMIs and the like). */
  repeatMonthly: boolean;
};

export type SpreadMonths = 1 | 3 | 6 | 12;

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
