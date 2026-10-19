"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  extendTrialAction,
  markPaymentReceivedAction,
  savePaymentDetailsAction,
  updatePlanAction,
} from "@/app/(admin)/admin/actions";
import {
  addDays,
  type PaymentDetails,
  type Subscription,
} from "@domain/billing/subscription";

const field =
  "rounded-2xl border border-[#DCDDF7] bg-[#F3F4FB] px-3.5 text-base font-normal";
const primary = "rounded-2xl bg-[#3A3FB8] px-5 text-sm font-bold text-white disabled:opacity-60";

function periodEnd(from: string, period: Subscription["billingPeriod"]) {
  const days = period === "year" ? 365 : period === "quarter" ? 91 : 30;
  return addDays(from, days);
}

export function CompanyBilling({
  organizationId,
  subscription,
  today,
  currentDue,
}: {
  organizationId: string;
  subscription: Subscription;
  today: string;
  currentDue: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"" | "trial" | "paid" | "plan">("");
  const [trialDate, setTrialDate] = useState(
    addDays(subscription.trialEndsOn ?? today, 15),
  );
  const [amount, setAmount] = useState(String(subscription.amountInr ?? ""));
  const [period, setPeriod] = useState(subscription.billingPeriod);
  const [paidOn, setPaidOn] = useState(today);
  const [mode, setMode] = useState("upi");
  const [reference, setReference] = useState("");
  const [paidUntil, setPaidUntil] = useState(
    periodEnd(currentDue && currentDue > today ? currentDue : today, subscription.billingPeriod),
  );

  async function run(action: () => Promise<{ error?: string }>) {
    setBusy(true);
    setError("");
    const result = await action();
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPanel("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setPanel(panel === "trial" ? "" : "trial")} className="h-[46px] rounded-2xl bg-[#F3F4FB] px-4 text-sm font-bold">
          Extend trial
        </button>
        <button type="button" onClick={() => setPanel(panel === "plan" ? "" : "plan")} className="h-[46px] rounded-2xl bg-[#F3F4FB] px-4 text-sm font-bold">
          Edit plan amount
        </button>
        <button type="button" onClick={() => setPanel(panel === "paid" ? "" : "paid")} className="h-[46px] rounded-2xl bg-[#3A3FB8] px-4 text-sm font-bold text-white">
          Mark payment received
        </button>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {panel === "trial" ? (
        <form
          className="flex flex-wrap items-end gap-3 rounded-2xl bg-[#F3F4FB] p-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => extendTrialAction(organizationId, trialDate));
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Trial ends on
            <input type="date" value={trialDate} onChange={(e) => setTrialDate(e.target.value)} className={field} />
          </label>
          <button type="submit" disabled={busy} className={primary}>Save</button>
        </form>
      ) : null}

      {panel === "plan" ? (
        <form
          className="flex flex-wrap items-end gap-3 rounded-2xl bg-[#F3F4FB] p-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => updatePlanAction(organizationId, { amountInr: amount, billingPeriod: period }));
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Amount (₹)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" className={field} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Every
            <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className={field}>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
              <option value="year">Year</option>
            </select>
          </label>
          <button type="submit" disabled={busy} className={primary}>Save</button>
        </form>
      ) : null}

      {panel === "paid" ? (
        <form
          className="flex flex-wrap items-end gap-3 rounded-2xl bg-[#F3F4FB] p-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() =>
              markPaymentReceivedAction(organizationId, { paidOn, amountInr: amount, mode, reference, paidUntil }),
            );
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Received on
            <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Amount (₹)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" className={field} required />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Paid by
            <select value={mode} onChange={(e) => setMode(e.target.value)} className={field}>
              <option value="upi">UPI</option>
              <option value="bank">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Reference
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI ref no." className={field} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Paid until
            <input type="date" value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)} className={field} />
          </label>
          <button type="submit" disabled={busy} className={primary}>Save payment</button>
        </form>
      ) : null}
    </div>
  );
}

export function PaymentDetailsForm({ initial }: { initial: PaymentDetails }) {
  const router = useRouter();
  const [details, setDetails] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function set<K extends keyof PaymentDetails>(key: K, value: string) {
    setDetails((current) => ({ ...current, [key]: value }));
    setMessage("");
  }

  async function save() {
    setBusy(true);
    const result = await savePaymentDetailsAction(details);
    setBusy(false);
    setMessage(result.error ?? "Saved. Companies see these details in their reminders.");
    if (!result.error) router.refresh();
  }

  const rows: [keyof PaymentDetails, string][] = [
    ["accountName", "Account name"],
    ["bankName", "Bank"],
    ["accountNumber", "A/C number"],
    ["ifsc", "IFSC"],
    ["upiId", "UPI ID"],
  ];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-3 rounded-3xl bg-white p-5"
    >
      <div>
        <h2 className="text-base font-extrabold">Where companies pay</h2>
        <p className="text-sm text-[#5B5E7A]">Shown in the payment reminders. Bank transfer or UPI only.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map(([key, label]) => (
          <label key={key} className="flex flex-col gap-1 text-sm font-semibold">
            {label}
            <input value={details[key]} onChange={(e) => set(key, e.target.value)} className={field} />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={primary}>Save details</button>
        {message ? <span className="text-sm text-[#5B5E7A]">{message}</span> : null}
      </div>
    </form>
  );
}
