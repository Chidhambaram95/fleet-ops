"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveCompanyAction } from "@/app/(app)/settings/company/actions";
import { shortDate, subscriptionStatus } from "@domain/billing/subscription";
import {
  BUS_TYPES,
  BUS_TYPE_LABELS,
  type BusType,
  type CompanyProfile,
} from "@domain/companies/types";
import { todayInIst } from "@domain/operations/totals";

const field = "rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-normal";

export function CompanySettings({ profile }: { profile: CompanyProfile }) {
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const [town, setTown] = useState(profile.town);
  const [gstin, setGstin] = useState(profile.gstin);
  const [whatsapp, setWhatsapp] = useState(profile.whatsappNumber);
  const [busTypes, setBusTypes] = useState<BusType[]>(profile.busTypes);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const status = subscriptionStatus(profile.subscription, todayInIst());

  function toggle(type: BusType) {
    setBusTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

  async function save() {
    setBusy(true);
    setMessage("");
    const result = await saveCompanyAction({ name, town, gstin, whatsappNumber: whatsapp, busTypes });
    setBusy(false);
    setFailed(Boolean(result.error));
    setMessage(result.error ?? "Saved.");
    if (!result.error) router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Company settings</h1>
        <p className="text-sm text-stone-600">
          The WhatsApp number is where the daily settlement is sent.
        </p>
      </div>

      <form
        className="flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          Company name
          <input value={name} onChange={(e) => setName(e.target.value)} required className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Town
          <input value={town} onChange={(e) => setTown(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          GSTIN (optional)
          <input value={gstin} onChange={(e) => setGstin(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          WhatsApp number for settlements
          <input
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            inputMode="tel"
            placeholder="98765 43210"
            className={field}
          />
        </label>
        <fieldset className="flex flex-col gap-1 text-sm font-medium">
          <legend className="mb-1">Bus types we run</legend>
          <div className="flex flex-wrap gap-2">
            {BUS_TYPES.map((type) => (
              <label
                key={type}
                className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm ${
                  busTypes.includes(type) ? "border-orange-700 bg-orange-50" : "border-stone-200"
                }`}
              >
                <input
                  type="checkbox"
                  checked={busTypes.includes(type)}
                  onChange={() => toggle(type)}
                  className="min-h-0"
                />
                {BUS_TYPE_LABELS[type]}
              </label>
            ))}
          </div>
        </fieldset>
        {message ? (
          <p className={`text-sm ${failed ? "text-red-700" : "text-green-800"}`}>{message}</p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </form>

      {profile.subscription ? (
        <section className="flex flex-col gap-1 rounded-2xl bg-white p-3 text-sm shadow-sm">
          <p className="font-semibold">Fleet Ops plan</p>
          <p className="text-stone-600">
            {profile.subscription.planLabel}
            {profile.subscription.amountInr
              ? ` · ₹${profile.subscription.amountInr.toLocaleString("en-IN")} / ${profile.subscription.billingPeriod}`
              : ""}
          </p>
          <p className="text-stone-600">
            {status.dueOn
              ? `${status.onTrial ? "Free trial ends" : "Next payment due"} ${shortDate(status.dueOn)}`
              : "No payment due"}
          </p>
        </section>
      ) : null}
    </div>
  );
}
