/** Days before a paid due date when admins and managers see the gentle banner. */
export const DUE_SOON_DAYS = 30;
/** A 30-day trial would show the banner the whole time, so it only shows near the end. */
export const TRIAL_DUE_SOON_DAYS = 7;
/** Days after the due date before the app becomes view-only. Mirrors org_in_good_standing(). */
export const GRACE_DAYS = 15;

export type Subscription = {
  planLabel: string;
  amountInr: number | null;
  billingPeriod: "month" | "quarter" | "year";
  trialEndsOn: string | null;
  nextDueOn: string | null;
};

export type SubscriptionState = "ok" | "due_soon" | "overdue" | "view_only";

export type SubscriptionStatus = {
  state: SubscriptionState;
  /** The date the next payment (or the end of the trial) falls on. */
  dueOn: string | null;
  onTrial: boolean;
  /** Positive before the due date, negative after. */
  daysLeft: number | null;
};

export type PaymentDetails = {
  accountName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  upiId: string;
};

function dayNumber(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function daysBetween(fromIso: string, toIso: string) {
  return dayNumber(toIso) - dayNumber(fromIso);
}

export function addDays(isoDate: string, days: number) {
  return new Date((dayNumber(isoDate) + days) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export function subscriptionStatus(
  subscription: Subscription | null,
  today: string,
): SubscriptionStatus {
  const dueOn = subscription?.nextDueOn ?? subscription?.trialEndsOn ?? null;
  const onTrial = !subscription?.nextDueOn;
  if (!dueOn) {
    return { state: "ok", dueOn: null, onTrial, daysLeft: null };
  }

  const daysLeft = daysBetween(today, dueOn);
  if (daysLeft < 0) {
    const state = -daysLeft > GRACE_DAYS ? "view_only" : "overdue";
    return { state, dueOn, onTrial, daysLeft };
  }
  const lead = onTrial ? TRIAL_DUE_SOON_DAYS : DUE_SOON_DAYS;
  return {
    state: daysLeft <= lead ? "due_soon" : "ok",
    dueOn,
    onTrial,
    daysLeft,
  };
}

/** "18 Nov" from an ISO date. */
export function shortDate(isoDate: string) {
  const [, month, day] = isoDate.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${names[month - 1]}`;
}

export function paymentDetailsText(details: PaymentDetails, amountInr: number | null) {
  const lines = ["Fleet Ops plan payment"];
  if (amountInr) lines.push(`Amount: ₹${amountInr.toLocaleString("en-IN")}`);
  if (details.accountName) lines.push(`Account name: ${details.accountName}`);
  if (details.bankName) lines.push(`Bank: ${details.bankName}`);
  if (details.accountNumber) lines.push(`A/C number: ${details.accountNumber}`);
  if (details.ifsc) lines.push(`IFSC: ${details.ifsc}`);
  if (details.upiId) lines.push(`UPI ID: ${details.upiId}`);
  return lines.join("\n");
}
