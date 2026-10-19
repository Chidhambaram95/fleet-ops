import Link from "next/link";
import {
  getPlatformPaymentDetails,
  listCompanies,
  listSubscriptionPayments,
} from "@data/companies/repository";
import { shortDate, subscriptionStatus } from "@domain/billing/subscription";
import { todayInIst } from "@domain/operations/totals";
import { CompanyBilling, PaymentDetailsForm } from "@/components/admin/PaymentsPanel";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata = { title: "Payments · Fleet Ops" };

const MODE_LABELS: Record<string, string> = {
  upi: "UPI",
  bank: "Bank transfer",
  cash: "Cash",
  other: "Other",
};

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  const supabase = await createServerSupabaseClient();
  let companies;
  try {
    companies = await listCompanies(supabase);
  } catch (error) {
    return (
      <p className="rounded-2xl bg-white p-4 text-red-700">
        {error instanceof Error ? error.message : "Could not load payments."}
      </p>
    );
  }
  const selected = companies.find((c) => c.organizationId === org) ?? companies[0];
  const [payments, details] = await Promise.all([
    selected ? listSubscriptionPayments(supabase, selected.organizationId) : Promise.resolve([]),
    getPlatformPaymentDetails(supabase),
  ]);
  const today = todayInIst();
  const status = selected ? subscriptionStatus(selected.subscription, today) : null;

  const tile = "flex flex-col gap-0.5 rounded-[18px] bg-[#F3F4FB] p-3.5";
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-extrabold">Payments</h1>
      <div className="flex flex-wrap items-start gap-5">
        <nav aria-label="Companies" className="flex w-full flex-col gap-1 rounded-3xl bg-white p-2.5 sm:max-w-xs">
          {companies.map((company) => {
            const s = subscriptionStatus(company.subscription, today);
            const active = company.organizationId === selected?.organizationId;
            return (
              <Link
                key={company.organizationId}
                href={`/admin/payments?org=${company.organizationId}`}
                className={`flex items-center justify-between gap-2 rounded-2xl p-3 ${active ? "bg-[#E6E7FA]" : ""}`}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-bold">{company.name}</span>
                  <span className="text-xs text-[#5B5E7A]">
                    {s.dueOn ? `${s.onTrial ? "Trial ends" : "Next"}: ${shortDate(s.dueOn)}` : "No due date"}
                  </span>
                </span>
                {s.state === "overdue" || s.state === "view_only" ? (
                  <span className="rounded-full bg-[#FDECEA] px-2.5 py-1 text-xs font-bold text-[#A3321C]">Overdue</span>
                ) : s.state === "due_soon" ? (
                  <span className="rounded-full bg-[#FFF5E5] px-2.5 py-1 text-xs font-bold text-[#8A5300]">Due soon</span>
                ) : null}
              </Link>
            );
          })}
          {companies.length === 0 ? <p className="p-3 text-sm text-[#5B5E7A]">No companies yet.</p> : null}
        </nav>

        <div className="flex min-w-0 flex-1 basis-[460px] flex-col gap-4">
          {selected && status ? (
            <section className="flex flex-col gap-4 rounded-3xl bg-white p-5">
              <div>
                <h2 className="text-xl font-extrabold">{selected.name}</h2>
                <p className="text-sm text-[#5B5E7A]">Fleet Ops subscription</p>
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
                <div className={tile}><span className="text-xs text-[#5B5E7A]">Plan</span><span className="font-extrabold">{selected.subscription.planLabel}</span></div>
                <div className={tile}>
                  <span className="text-xs text-[#5B5E7A]">Amount</span>
                  <span className="font-extrabold">
                    {selected.subscription.amountInr
                      ? `₹${selected.subscription.amountInr.toLocaleString("en-IN")} / ${selected.subscription.billingPeriod}`
                      : "Not set"}
                  </span>
                </div>
                <div className={tile}>
                  <span className="text-xs text-[#5B5E7A]">Free trial</span>
                  <span className="font-extrabold">
                    {selected.subscription.trialEndsOn ? `Ends ${shortDate(selected.subscription.trialEndsOn)}` : "—"}
                  </span>
                </div>
                <div className={tile}>
                  <span className="text-xs text-[#5B5E7A]">{status.onTrial ? "Trial ends" : "Next due"}</span>
                  <span className="font-extrabold">
                    {status.dueOn && status.daysLeft !== null
                      ? `${shortDate(status.dueOn)} · ${status.daysLeft >= 0 ? `in ${status.daysLeft} days` : `${-status.daysLeft} days ago`}`
                      : "—"}
                  </span>
                </div>
                <div className={tile}>
                  <span className="text-xs text-[#5B5E7A]">What they see now</span>
                  <span className="font-extrabold">
                    {{ ok: "Nothing", due_soon: "Gentle banner", overdue: "Overdue popup", view_only: "View-only app" }[status.state]}
                  </span>
                </div>
              </div>
              <CompanyBilling
                key={selected.organizationId}
                organizationId={selected.organizationId}
                subscription={selected.subscription}
                today={today}
                currentDue={status.dueOn}
              />
            </section>
          ) : null}

          {selected ? (
            <section className="overflow-x-auto rounded-3xl bg-white px-5 pb-3 pt-2">
              <h2 className="py-3 text-base font-extrabold">Payment history</h2>
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[#5B5E7A]">
                    <th className="py-2 pr-2 font-semibold">Paid on</th>
                    <th className="py-2 pr-2 font-semibold">Paid until</th>
                    <th className="py-2 pr-2 font-semibold">Mode</th>
                    <th className="py-2 pr-2 font-semibold">Reference</th>
                    <th className="py-2 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-[#EEEFF7]">
                      <td className="py-3 pr-2">{p.paidOn}</td>
                      <td className="py-3 pr-2">{p.paidUntil}</td>
                      <td className="py-3 pr-2">{MODE_LABELS[p.mode] ?? p.mode}</td>
                      <td className="py-3 pr-2 text-[#5B5E7A]">{p.reference || "—"}</td>
                      <td className="py-3 text-right font-bold">₹{p.amountInr.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {payments.length === 0 ? <p className="py-3 text-sm text-[#5B5E7A]">No payments recorded yet.</p> : null}
            </section>
          ) : null}

          <PaymentDetailsForm initial={details} />
        </div>
      </div>
    </div>
  );
}
