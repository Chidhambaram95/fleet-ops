"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveCompanyAction } from "@/app/(app)/settings/company/actions";
import { shortDate, subscriptionStatus } from "@domain/billing/subscription";
import { BUS_TYPES, type BusType, type CompanyProfile } from "@domain/companies/types";
import { MODULE_TITLES } from "@domain/modules/modules";
import { todayInIst } from "@domain/operations/totals";

const field = "h-12 rounded-2xl bg-canvas px-4 text-base font-normal";

export function CompanySettings({ profile }: { profile: CompanyProfile }) {
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const [town, setTown] = useState(profile.town);
  const [gstin, setGstin] = useState(profile.gstin);
  const [whatsapp, setWhatsapp] = useState(profile.whatsappNumber);
  // Fleet Ops sets which modules the company may use; the admin switches them on.
  const allowed = BUS_TYPES.filter((type) => profile.busTypes.includes(type));
  const [enabled, setEnabled] = useState<BusType[]>(
    allowed.filter((type) => !profile.enabledModules || profile.enabledModules.includes(type)),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const status = subscriptionStatus(profile.subscription, todayInIst());
  const viewOnly = status.state === "view_only";

  function toggle(type: BusType) {
    setEnabled((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

  async function save() {
    setBusy(true);
    setMessage("");
    const result = await saveCompanyAction({ name, town, gstin, whatsappNumber: whatsapp, enabledModules: enabled });
    setBusy(false);
    setFailed(Boolean(result.error));
    setMessage(result.error ?? "Saved.");
    if (!result.error) router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-extrabold">Company settings</h1>
        <p className="text-sm text-muted">
          The WhatsApp number is where the daily summary is sent.
        </p>
      </div>

      <form
        className="flex flex-col gap-3 rounded-3xl bg-white p-4 md:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {viewOnly ? (
          <p className="text-sm text-muted">The app is view-only until the payment is received.</p>
        ) : null}
        <fieldset disabled={viewOnly} className="flex flex-col gap-3 disabled:opacity-70">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Company name
          <input value={name} onChange={(e) => setName(e.target.value)} required className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Town
          <input value={town} onChange={(e) => setTown(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          GSTIN (optional)
          <input value={gstin} onChange={(e) => setGstin(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          WhatsApp number for daily summaries
          <input
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            inputMode="tel"
            placeholder="98765 43210"
            className={field}
          />
        </label>
        <fieldset className="flex flex-col gap-1.5 text-[13px] font-semibold">
          <legend className="mb-1">Bus types you run</legend>
          <div className="flex flex-wrap gap-2">
            {allowed.map((type) => (
              <label
                key={type}
                className={`flex min-h-11 items-center gap-2 rounded-2xl border-2 px-3 text-sm ${
                  enabled.includes(type) ? "border-brand bg-brand-soft" : "border-line"
                }`}
              >
                <input
                  type="checkbox"
                  checked={enabled.includes(type)}
                  onChange={() => toggle(type)}
                  className="min-h-0"
                />
                {MODULE_TITLES[type]}
              </label>
            ))}
          </div>
          <span className="font-normal text-muted">
            Each bus type has its own menu and screens. Switching one off hides it but keeps its data.
            {allowed.length < BUS_TYPES.length ? " To add another bus type, contact Fleet Ops." : ""}
          </span>
        </fieldset>
        {message ? (
          <p className={`text-sm ${failed ? "text-money-out" : "text-money-in"}`}>{message}</p>
        ) : null}
        </fieldset>
        {viewOnly ? null : (
          <button
            type="submit"
            disabled={busy}
            className="h-12 rounded-2xl bg-brand px-4 text-[15px] font-bold text-white disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        )}
      </form>

      {profile.subscription ? (
        <section className="flex flex-col gap-1 rounded-3xl bg-white p-4 text-sm md:p-5">
          <p className="font-semibold">Fleet Ops plan</p>
          <p className="text-muted">
            {profile.subscription.planLabel}
            {profile.subscription.amountInr
              ? ` · ₹${profile.subscription.amountInr.toLocaleString("en-IN")} / ${profile.subscription.billingPeriod}`
              : ""}
          </p>
          <p className="text-muted">
            {status.dueOn
              ? `${status.onTrial ? "Free trial ends" : "Next payment due"} ${shortDate(status.dueOn)}`
              : "No payment due"}
          </p>
        </section>
      ) : null}
    </div>
  );
}
