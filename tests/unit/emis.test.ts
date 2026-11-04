import { describe, expect, it } from "vitest";
import {
  emiAlertText,
  emiAlerts,
  emiReminderText,
  loanMonths,
  loanSummary,
  loansForModule,
  monthsBetween,
  nextEmiMonth,
  sweepDate,
  type Loan,
  type LoanEmi,
} from "@domain/loans/emis";

const loan = (id: string, extra: Partial<Loan> = {}): Loan => ({
  id,
  busIds: ["T1"],
  lender: "HDFC",
  loanRef: "",
  debitAccount: "Current account",
  emiInr: 40000,
  sweepDay: 5,
  firstMonth: "2026-11-01",
  lastMonth: "2027-10-01",
  note: "",
  ...extra,
});

const record = (loanId: string, dueMonth: string, extra: Partial<LoanEmi> = {}): LoanEmi => ({
  id: `${loanId}-${dueMonth}`,
  loanId,
  dueMonth,
  status: "cleared",
  amountInr: 40000,
  fundsAddedOn: null,
  retryOn: null,
  clearedOn: dueMonth.replace("-01", "-05"),
  feeInr: 0,
  fineInr: 0,
  note: "",
  expenseId: null,
  ...extra,
});

const name = (id: string) => ({ T1: "TN01T1", T2: "TN01T2", O1: "TN01O1" })[id] ?? id;

describe("EMI dates", () => {
  it("moves a sweep day past the month's end to its last day", () => {
    expect(sweepDate("2027-02-01", 31)).toBe("2027-02-28");
    expect(sweepDate("2026-11-01", 31)).toBe("2026-11-30");
    expect(sweepDate("2026-12-01", 5)).toBe("2026-12-05");
  });

  it("starts tracking from the next EMI still to come", () => {
    expect(nextEmiMonth(5, "2026-11-04")).toBe("2026-11-01");
    expect(nextEmiMonth(5, "2026-11-06")).toBe("2026-12-01");
    expect(nextEmiMonth(5, "2026-12-20")).toBe("2027-01-01");
  });

  it("counts months both ends included", () => {
    expect(monthsBetween("2026-11-01", "2027-10-01")).toBe(12);
    expect(monthsBetween("2027-01-01", "2026-12-01")).toBe(0);
  });
});

describe("a loan's months and what is left", () => {
  const records = [record("a", "2026-11-01", { feeInr: 590, fineInr: 200 })];

  it("lists each month, with a missed one's retry date as its due day", () => {
    const months = loanMonths(loan("a"), [
      ...records,
      record("a", "2026-12-01", { status: "missed", clearedOn: null, retryOn: "2026-12-09", note: "Low balance" }),
    ]);
    expect(months).toHaveLength(12);
    expect(months[0]).toMatchObject({ status: "cleared", dueOn: "2026-11-05" });
    expect(months[1]).toMatchObject({ status: "missed", dueOn: "2026-12-09" });
    expect(months[2]).toMatchObject({ status: "due", dueOn: "2027-01-05", amountInr: 40000 });
  });

  it("works out EMIs and money left, fees this year, and ending soon", () => {
    expect(loanSummary(loan("a"), records, "2026-11-10")).toEqual({
      left: 11,
      total: 12,
      moneyLeft: 440000,
      feesThisYear: 790,
      endingSoon: false,
      closed: false,
    });
    expect(loanSummary(loan("a"), records, "2027-08-10").endingSoon).toBe(true);
  });
});

describe("EMI alerts", () => {
  const loans = [
    loan("a"),
    loan("b", { busIds: ["T2"], emiInr: 25000 }),
    loan("c", { busIds: ["O1"], debitAccount: "Omni account", sweepDay: 20 }),
  ];

  it("sums EMIs swept from one account on the same day, within the reminder days", () => {
    const alerts = emiAlerts(loans, [], "2026-11-02", 3);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "keep_funds", days: 3, amountInr: 65000, account: "Current account" });
    expect(emiAlertText(alerts[0], name)).toBe("Keep ₹65,000 in Current account by 5 Nov: 2 EMIs (TN01T1, TN01T2)");
    // Four days ahead is outside a 3-day reminder, inside a 5-day one.
    expect(emiAlerts(loans, [], "2026-11-01", 3)).toHaveLength(0);
    expect(emiAlerts(loans, [], "2026-11-01", 5)).toHaveLength(1);
  });

  it("says tomorrow and today", () => {
    expect(emiAlertText(emiAlerts(loans, [], "2026-11-04")[0], name)).toContain("by tomorrow");
    expect(emiAlertText(emiAlerts(loans, [], "2026-11-05")[0], name)).toContain(" today:");
  });

  it("asks to confirm after the sweep, then turns overdue after 3 days", () => {
    const confirm = emiAlerts(loans, [record("a", "2026-11-01")], "2026-11-07");
    expect(confirm.map((alert) => alert.kind)).toEqual(["confirm"]);
    expect(emiAlertText(confirm[0], name)).toContain("TN01T2: EMI of ₹25,000 swept 5 Nov");
    const late = emiAlerts(loans, [record("a", "2026-11-01")], "2026-11-09");
    expect(late.map((alert) => alert.kind)).toEqual(["overdue"]);
    expect(emiAlertText(late[0], name)).toBe("TN01T2: Nov 2026 EMI of ₹25,000 not marked cleared since 5 Nov");
  });

  it("keeps a missed EMI red until it is cleared, and a paid one quiet", () => {
    const missed = record("b", "2026-11-01", { status: "missed", clearedOn: null, note: "Low balance", amountInr: 25000 });
    const alerts = emiAlerts(loans, [record("a", "2026-11-01"), missed], "2026-11-06");
    expect(alerts[0].kind).toBe("overdue");
    expect(emiAlertText(alerts[0], name)).toBe("TN01T2: Nov 2026 EMI of ₹25,000 missed (Low balance)");
    const paid = emiAlerts(loans, [record("a", "2026-11-01"), { ...missed, status: "cleared", clearedOn: "2026-11-09" }], "2026-11-10");
    expect(paid).toHaveLength(0);
  });

  it("puts overdue first and makes a WhatsApp text", () => {
    const alerts = emiAlerts(loans, [record("a", "2026-11-01")], "2026-11-18");
    expect(alerts.map((alert) => alert.kind)).toEqual(["overdue", "keep_funds"]);
    expect(emiReminderText(alerts, name).split("\n")[0]).toBe("*EMI reminders*");
  });

  it("shows a module the loans with any of its buses", () => {
    const type = (id: string) => (id.startsWith("T") ? "town" : "omni");
    const shared = loan("d", { busIds: ["T1", "O1"] });
    expect(loansForModule([...loans, shared], type, "omni").map((item) => item.id)).toEqual(["c", "d"]);
  });
});
