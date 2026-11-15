import type { ModuleId } from "@domain/modules/modules";

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
