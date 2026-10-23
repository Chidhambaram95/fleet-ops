import { describe, expect, it } from "vitest";
import { subscriptionStatus } from "@domain/billing/subscription";
import { formatInr, shiftDate, todayInIst, totalsForEntries } from "@domain/operations/totals";
import type { DailyEntry } from "@domain/operations/types";
import { clashFor, tourDays, whatsappDigits } from "@domain/tours/calc";
import type { TourBooking } from "@domain/tours/types";

describe("day totals", () => {
  it("adds money in and money out", () => {
    const entries = [
      { kind: "income", amountInr: 5000 },
      { kind: "expense", amountInr: 1200 },
      { kind: "expense", amountInr: 300 },
    ] as DailyEntry[];
    expect(totalsForEntries(entries)).toEqual({ incomeInr: 5000, expenseInr: 1500, netInr: 3500 });
  });

  it("writes rupees the Indian way", () => {
    expect(formatInr(125000)).toBe("₹1,25,000");
    expect(formatInr(-500)).toBe("−₹500");
  });

  it("uses India time for today", () => {
    // 20:00 UTC is already the next day in India.
    expect(todayInIst(new Date("2026-10-22T20:00:00Z"))).toBe("2026-10-23");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("subscription", () => {
  const plan = { planLabel: "Plan", amountInr: 999, billingPeriod: "month" as const, trialEndsOn: null };

  it("is fine well before the due date", () => {
    expect(subscriptionStatus({ ...plan, nextDueOn: "2026-12-31" }, "2026-10-23").state).toBe("ok");
  });

  it("warns near the due date, then turns view-only after 15 days", () => {
    expect(subscriptionStatus({ ...plan, nextDueOn: "2026-11-01" }, "2026-10-23").state).toBe("due_soon");
    expect(subscriptionStatus({ ...plan, nextDueOn: "2026-10-10" }, "2026-10-23").state).toBe("overdue");
    expect(subscriptionStatus({ ...plan, nextDueOn: "2026-10-01" }, "2026-10-23").state).toBe("view_only");
  });
});

describe("tours", () => {
  function booking(overrides: Partial<TourBooking>): TourBooking {
    return {
      id: "t1",
      quoteNo: 1,
      status: "confirmed",
      customerName: "",
      customerPhone: "",
      pickup: "",
      dropPlace: "",
      seatsNeeded: null,
      startDate: "2026-11-01",
      endDate: "2026-11-02",
      startAt: null,
      endAt: null,
      busId: "b1",
      hireAmountInr: 0,
      advanceRequiredInr: 0,
      inclusions: "",
      quoteValidUntil: null,
      quoteSentAt: null,
      tripId: null,
      note: "",
      cancelledReason: "",
      createdAt: "",
      ...overrides,
    };
  }

  it("counts both the first and the last day", () => {
    expect(tourDays({ startDate: "2026-11-01", endDate: "2026-11-03" })).toBe(3);
  });

  it("blocks a bus booked twice at the same time", () => {
    const first = booking({ startAt: "2026-11-01T06:00:00+05:30", endAt: "2026-11-01T20:00:00+05:30" });
    const second = booking({ id: "t2", startAt: "2026-11-01T10:00:00+05:30", endAt: "2026-11-01T22:00:00+05:30" });
    expect(clashFor(second, [first], { turnaroundHours: 2 }).kind).toBe("block");
  });

  it("only warns when either booking is whole days", () => {
    const first = booking({});
    const second = booking({ id: "t2", startDate: "2026-11-02", endDate: "2026-11-02" });
    expect(clashFor(second, [first], { turnaroundHours: 2 })).toMatchObject({ kind: "warn", reason: "whole_day" });
  });

  it("ignores other buses and cancelled bookings", () => {
    const other = booking({ busId: "b2" });
    const cancelled = booking({ id: "t3", status: "cancelled" });
    expect(clashFor(booking({ id: "t2" }), [other, cancelled], { turnaroundHours: 2 }).kind).toBe("none");
  });

  it("adds the India code to a 10-digit WhatsApp number", () => {
    expect(whatsappDigits("98765 43210")).toBe("919876543210");
  });
});
