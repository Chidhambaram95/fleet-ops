/** Bus loans, their monthly EMIs and the reminders before each auto-sweep. */

export type EmiStatus = "due" | "missed" | "funds_added" | "cleared";

export const EMI_STATUS_LABELS: Record<EmiStatus, string> = {
  due: "Due",
  missed: "Missed",
  funds_added: "Funds added",
  cleared: "Cleared",
};

export type Loan = {
  id: string;
  busIds: string[];
  lender: string;
  loanRef: string;
  debitAccount: string;
  emiInr: number;
  /** Day of the month the bank sweeps the EMI (1–31; short months use their last day). */
  sweepDay: number;
  /** First EMI month tracked, YYYY-MM-01. */
  firstMonth: string;
  /** Last EMI month, YYYY-MM-01. */
  lastMonth: string;
  note: string;
};

/** A month someone acted on. A month with no record is simply due. */
export type LoanEmi = {
  id: string;
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
  expenseId: string | null;
};

/** One month of a loan, with its record if there is one. */
export type EmiMonth = {
  loan: Loan;
  month: string;
  /** The day the bank takes it: the retry date after a miss, else the sweep day. */
  dueOn: string;
  status: EmiStatus;
  amountInr: number;
  record: LoanEmi | null;
};

export const DEFAULT_REMINDER_DAYS = 3;
/** Days after the sweep to wait for it to show as cleared before it turns red. */
export const CONFIRM_GRACE_DAYS = 3;

const pad = (value: number) => String(value).padStart(2, "0");

export function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

export function addMonths(month: string, count: number) {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + count;
  const date = new Date(Date.UTC(year, index, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-01`;
}

/** Months from one month to another, both counted; 0 when the end is earlier. */
export function monthsBetween(from: string, to: string) {
  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
  return months < 0 ? 0 : months + 1;
}

/** The sweep date in a month: day 31 in a 30-day month is the 30th. */
export function sweepDate(month: string, sweepDay: number) {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month.slice(0, 7)}-${pad(Math.min(sweepDay, last))}`;
}

export function daysFrom(today: string, date: string) {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** The first EMI still to come after today: this month's if its sweep is today or later, else next month's. */
export function nextEmiMonth(sweepDay: number, today: string) {
  const month = monthStart(today);
  return sweepDate(month, sweepDay) >= today ? month : addMonths(month, 1);
}

/** Every month of a loan, first to last. */
export function loanMonths(loan: Loan, records: LoanEmi[]): EmiMonth[] {
  const byMonth = new Map(records.filter((item) => item.loanId === loan.id).map((item) => [item.dueMonth, item]));
  const count = Math.min(monthsBetween(loan.firstMonth, loan.lastMonth), 600);
  return Array.from({ length: count }, (_, index) => {
    const month = addMonths(loan.firstMonth, index);
    const record = byMonth.get(month) ?? null;
    const status = record?.status ?? "due";
    return {
      loan,
      month,
      dueOn: record?.retryOn && status !== "cleared" ? record.retryOn : sweepDate(month, loan.sweepDay),
      status,
      amountInr: record?.amountInr ?? loan.emiInr,
      record,
    };
  });
}

export type LoanSummary = {
  left: number;
  total: number;
  moneyLeft: number;
  /** Fees and fines paid this calendar year. */
  feesThisYear: number;
  endingSoon: boolean;
  closed: boolean;
};

export function loanSummary(loan: Loan, records: LoanEmi[], today: string): LoanSummary {
  const months = loanMonths(loan, records);
  const open = months.filter((item) => item.status !== "cleared");
  const year = today.slice(0, 4);
  const feesThisYear = records
    .filter((item) => item.loanId === loan.id && item.status === "cleared" && (item.clearedOn ?? "").startsWith(year))
    .reduce((total, item) => total + item.feeInr + item.fineInr, 0);
  const thisMonth = monthStart(today);
  return {
    left: open.length,
    total: months.length,
    moneyLeft: open.reduce((total, item) => total + item.amountInr, 0),
    feesThisYear,
    endingSoon: loan.lastMonth >= thisMonth && monthsBetween(thisMonth, loan.lastMonth) <= 3,
    closed: open.length === 0 && loan.lastMonth < thisMonth,
  };
}

export type EmiAlert =
  | {
      kind: "keep_funds";
      /** Days to the sweep: 0 today. */
      days: number;
      dueOn: string;
      account: string;
      amountInr: number;
      items: EmiMonth[];
    }
  | { kind: "confirm" | "overdue"; days: number; dueOn: string; account: string; amountInr: number; items: EmiMonth[] };

/**
 * What needs a look, most urgent first:
 * - overdue: missed, or the sweep was more than 3 days ago and it isn't cleared;
 * - confirm: the sweep was in the last 3 days, waiting to be marked cleared;
 * - keep_funds: a sweep within the reminder days, summed by account and day.
 */
export function emiAlerts(loans: Loan[], records: LoanEmi[], today: string, reminderDays = DEFAULT_REMINDER_DAYS): EmiAlert[] {
  const open = loans.flatMap((loan) => loanMonths(loan, records)).filter((item) => item.status !== "cleared");
  const groups = new Map<string, EmiAlert>();
  for (const item of open) {
    const days = daysFrom(today, item.dueOn);
    const kind =
      item.status === "missed" || days < -CONFIRM_GRACE_DAYS
        ? "overdue"
        : days < 0
          ? "confirm"
          : days <= reminderDays
            ? "keep_funds"
            : null;
    if (!kind) continue;
    const account = item.loan.debitAccount.trim() || "the loan account";
    // Overdue EMIs stand alone; the others are summed per account and day.
    const key = kind === "overdue" ? `${kind}|${item.loan.id}|${item.month}` : `${kind}|${account}|${item.dueOn}`;
    const found = groups.get(key);
    if (found) {
      found.amountInr += item.amountInr;
      found.items.push(item);
    } else {
      groups.set(key, { kind, days, dueOn: item.dueOn, account, amountInr: item.amountInr, items: [item] });
    }
  }
  const order = { overdue: 0, confirm: 1, keep_funds: 2 };
  return [...groups.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.dueOn.localeCompare(b.dueOn));
}

const MONTH = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export const monthLabel = (month: string) => MONTH.format(new Date(`${month}T00:00:00Z`));
export const dayLabel = (date: string) => DAY.format(new Date(`${date}T00:00:00Z`));

function inr(value: number) {
  return `₹${value.toLocaleString("en-IN")}`;
}

/** One line for an alert, with the buses named by `busName`. */
export function emiAlertText(alert: EmiAlert, busName: (id: string) => string): string {
  const buses = [...new Set(alert.items.map((item) => item.loan.busIds.map(busName).join(" + ")))].join(", ");
  const count = alert.items.length;
  if (alert.kind === "keep_funds") {
    const when = alert.days === 0 ? "today" : alert.days === 1 ? "by tomorrow" : `by ${dayLabel(alert.dueOn)}`;
    return `Keep ${inr(alert.amountInr)} in ${alert.account} ${when}: ${count} EMI${count === 1 ? "" : "s"} (${buses})`;
  }
  if (alert.kind === "confirm") {
    return `${buses}: EMI of ${inr(alert.amountInr)} swept ${dayLabel(alert.dueOn)}. Mark cleared once it shows in the bank`;
  }
  const item = alert.items[0];
  return item.status === "missed"
    ? `${buses}: ${monthLabel(item.month)} EMI of ${inr(item.amountInr)} missed${item.record?.note ? ` (${item.record.note})` : ""}`
    : `${buses}: ${monthLabel(item.month)} EMI of ${inr(item.amountInr)} not marked cleared since ${dayLabel(alert.dueOn)}`;
}

/** WhatsApp text: what to keep in each account, and anything missed. */
export function emiReminderText(alerts: EmiAlert[], busName: (id: string) => string): string {
  return ["*EMI reminders*", ...alerts.map((alert) => `• ${emiAlertText(alert, busName)}`)].join("\n");
}

/** Loans with at least one bus of the module (all loans when none is given). */
export function loansForModule(loans: Loan[], busType: (id: string) => string | undefined, module?: string) {
  return module ? loans.filter((loan) => loan.busIds.some((id) => busType(id) === module)) : loans;
}
