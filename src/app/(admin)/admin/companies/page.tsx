import Link from "next/link";
import { listAllSubscriptionPayments, listCompanies } from "@data/companies/repository";
import { shortDate, subscriptionStatus } from "@domain/billing/subscription";
import { BUS_TYPE_LABELS } from "@domain/companies/types";
import { todayInIst } from "@domain/operations/totals";
import { AddCompanyForm } from "@/components/admin/AddCompanyForm";
import { InviteShare } from "@/components/admin/InviteShare";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata = { title: "Companies · Fleet Ops" };

const badge: Record<string, string> = {
  ok: "bg-[#E3F4EA] text-[#1E6B45]",
  due_soon: "bg-[#FFF5E5] text-[#8A5300]",
  overdue: "bg-[#FDECEA] text-[#A3321C]",
  view_only: "bg-[#1A1B2E] text-white",
};

export default async function CompaniesPage() {
  const supabase = await createServerSupabaseClient();
  let companies;
  try {
    companies = await listCompanies(supabase);
  } catch (error) {
    return (
      <p className="rounded-2xl bg-white p-4 text-red-700">
        {error instanceof Error ? error.message : "Could not load companies."} Run the
        0008 migration in the Supabase SQL editor first.
      </p>
    );
  }
  const today = todayInIst();
  const payments = await listAllSubscriptionPayments(supabase).catch(() => []);
  const collected = payments
    .filter((payment) => payment.paidOn.slice(0, 7) === today.slice(0, 7))
    .reduce((total, payment) => total + payment.amountInr, 0);
  const live = companies.filter((company) => !company.deactivatedAt);
  const overdue = live.filter((company) => {
    const state = subscriptionStatus(company.subscription, today).state;
    return state === "overdue" || state === "view_only";
  }).length;
  const tiles = [
    { label: "Companies", value: String(live.length) },
    { label: "On trial", value: String(live.filter((company) => !company.subscription.nextDueOn).length) },
    { label: "Overdue", value: String(overdue) },
    { label: "Collected this month", value: `₹${collected.toLocaleString("en-IN")}` },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold">Companies</h1>
        <p className="text-sm text-[#5B5E7A]">
          {companies.length} {companies.length === 1 ? "company" : "companies"} on Fleet Ops
        </p>
      </div>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="flex flex-col gap-0.5 rounded-[18px] bg-white p-3.5">
            <span className="text-xs text-[#5B5E7A]">{tile.label}</span>
            <span className="text-xl font-extrabold">{tile.value}</span>
          </div>
        ))}
      </section>
      <AddCompanyForm />
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {companies.map((company) => {
          const status = subscriptionStatus(company.subscription, today);
          const label = company.deactivatedAt
            ? "Deactivated"
            : status.state === "ok"
              ? status.onTrial
                ? "Free trial"
                : "Active"
              : status.state === "due_soon"
                ? "Due soon"
                : status.state === "overdue"
                  ? "Overdue"
                  : "View-only";
          return (
            <article key={company.organizationId} className="relative flex flex-col gap-3 rounded-3xl bg-white p-4 hover:ring-2 hover:ring-[#D9DAF6]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-extrabold">
                    {/* The whole card opens the company; the stretched link covers it. */}
                    <Link href={`/admin/companies/${company.organizationId}`} className="after:absolute after:inset-0 after:rounded-3xl">
                      {company.name}
                    </Link>
                  </h2>
                  <p className="text-xs text-[#5B5E7A]">
                    {[company.town, company.busTypes.map((t) => BUS_TYPE_LABELS[t]).join(", ")]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${company.deactivatedAt ? "bg-[#EEEFF7] text-[#5B5E7A]" : badge[status.state]}`}>
                  {label}
                </span>
              </div>
              <p className="text-sm text-[#5B5E7A]">
                {company.busCount}
                {company.maxBuses != null ? ` of ${company.maxBuses}` : ""} buses · {company.memberCount} people
                {company.adminName ? ` · Admin ${company.adminName}` : ""}
              </p>
              <p className="text-sm">
                {!company.subscription.nextDueOn
                  ? `Trial ${company.trialStartsOn ? shortDate(company.trialStartsOn) : "?"} to ${
                      company.subscription.trialEndsOn ? shortDate(company.subscription.trialEndsOn) : "?"
                    }`
                  : `Next due ${shortDate(company.subscription.nextDueOn)}`}
              </p>
              {company.pendingInviteToken ? (
                <div className="relative z-10 flex flex-col gap-1.5 rounded-2xl bg-[#F3F4FB] p-3">
                  <span className="text-xs font-semibold text-[#5B5E7A]">
                    Admin has not joined yet
                  </span>
                  <InviteShare
                    token={company.pendingInviteToken}
                    company={company.name}
                    name={company.adminName}
                    whatsappNumber={company.pendingInviteWhatsapp}
                  />
                </div>
              ) : null}
              <span className="text-sm font-bold text-[#3A3FB8]">Open company ›</span>
            </article>
          );
        })}
      </section>
    </div>
  );
}
