import Link from "next/link";
import { listCompanies } from "@data/companies/repository";
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

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold">Companies</h1>
        <p className="text-sm text-[#5B5E7A]">
          {companies.length} {companies.length === 1 ? "company" : "companies"} on Fleet Ops
        </p>
      </div>
      <AddCompanyForm />
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {companies.map((company) => {
          const status = subscriptionStatus(company.subscription, today);
          const label =
            status.state === "ok"
              ? status.onTrial
                ? "Free trial"
                : "Active"
              : status.state === "due_soon"
                ? "Due soon"
                : status.state === "overdue"
                  ? "Overdue"
                  : "View-only";
          return (
            <article key={company.organizationId} className="flex flex-col gap-3 rounded-3xl bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-extrabold">{company.name}</h2>
                  <p className="text-xs text-[#5B5E7A]">
                    {[company.town, company.busTypes.map((t) => BUS_TYPE_LABELS[t]).join(", ")]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${badge[status.state]}`}>
                  {label}
                </span>
              </div>
              <p className="text-sm text-[#5B5E7A]">
                {company.busCount} buses · {company.memberCount} people
                {company.adminName ? ` · Admin ${company.adminName}` : ""}
              </p>
              <p className="text-sm">
                {status.dueOn
                  ? `${status.onTrial ? "Trial ends" : "Next due"} ${shortDate(status.dueOn)}`
                  : "No due date"}
              </p>
              {company.pendingInviteToken ? (
                <div className="flex flex-col gap-1.5 rounded-2xl bg-[#F3F4FB] p-3">
                  <span className="text-xs font-semibold text-[#5B5E7A]">
                    Admin has not joined yet
                  </span>
                  <InviteShare
                    token={company.pendingInviteToken}
                    company={company.name}
                    name={company.adminName}
                    whatsappNumber=""
                  />
                </div>
              ) : null}
              <Link
                href={`/admin/payments?org=${company.organizationId}`}
                className="inline-flex items-center self-start text-sm font-bold text-[#3A3FB8]"
              >
                Payments ›
              </Link>
            </article>
          );
        })}
      </section>
    </div>
  );
}
