import Link from "next/link";
import { notFound } from "next/navigation";
import {
  listCompanies,
  listCompanyMembers,
  listPendingInvites,
} from "@data/companies/repository";
import { shortDate, subscriptionStatus } from "@domain/billing/subscription";
import { deletableFrom } from "@domain/companies/types";
import { todayInIst } from "@domain/operations/totals";
import { CompanyDanger, CompanyEditForm, CompanyPeople } from "@/components/admin/CompanyPanel";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata = { title: "Company · Fleet Ops" };

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  let companies;
  try {
    companies = await listCompanies(supabase);
  } catch (error) {
    return (
      <p className="rounded-2xl bg-white p-4 text-red-700">
        {error instanceof Error ? error.message : "Could not load this company."} Run the 0013 migration
        in the Supabase SQL editor first.
      </p>
    );
  }
  const company = companies.find((item) => item.organizationId === id);
  if (!company) notFound();

  const [members, invites] = await Promise.all([
    listCompanyMembers(supabase, id),
    listPendingInvites(supabase, id),
  ]);
  const today = todayInIst();
  const status = subscriptionStatus(company.subscription, today);
  const deleteFrom = company.deactivatedAt ? deletableFrom(company.deactivatedAt) : "";
  // The trial is shown only until the company's first payment.
  const onTrial = !company.subscription.nextDueOn;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/admin/companies" className="self-start text-sm font-bold text-[#3A3FB8]">
        ‹ All companies
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{company.name}</h1>
          <p className="text-sm text-[#5B5E7A]">
            {company.busCount} buses{company.maxBuses != null ? ` of ${company.maxBuses} allowed` : ""} ·{" "}
            {members.length} people
            {company.deactivatedAt ? " · Deactivated" : ""}
          </p>
        </div>
        <Link
          href={`/admin/payments?org=${company.organizationId}`}
          className="flex min-h-11 items-center rounded-2xl bg-white px-4 text-sm font-bold text-[#3A3FB8]"
        >
          Payments ›
        </Link>
      </div>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        {onTrial ? (
          <>
            <div className="flex flex-col gap-0.5 rounded-[18px] bg-white p-3.5">
              <span className="text-xs text-[#5B5E7A]">Trial started</span>
              <span className="font-extrabold">{company.trialStartsOn ? shortDate(company.trialStartsOn) : "—"}</span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-[18px] bg-white p-3.5">
              <span className="text-xs text-[#5B5E7A]">Trial ends</span>
              <span className="font-extrabold">
                {company.subscription.trialEndsOn ? shortDate(company.subscription.trialEndsOn) : "—"}
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-0.5 rounded-[18px] bg-white p-3.5">
            <span className="text-xs text-[#5B5E7A]">Next payment due</span>
            <span className="font-extrabold">{status.dueOn ? shortDate(status.dueOn) : "—"}</span>
          </div>
        )}
        <div className="flex flex-col gap-0.5 rounded-[18px] bg-white p-3.5">
          <span className="text-xs text-[#5B5E7A]">Plan</span>
          <span className="font-extrabold">
            {company.subscription.amountInr
              ? `₹${company.subscription.amountInr.toLocaleString("en-IN")} / ${company.subscription.billingPeriod}`
              : "Not set"}
          </span>
        </div>
      </section>

      <CompanyEditForm key={`${company.name}-${company.maxBuses}`} company={company} />
      <CompanyPeople company={company} members={members} invites={invites} />
      <CompanyDanger
        company={company}
        deletableOn={deleteFrom ? `${shortDate(deleteFrom)} ${deleteFrom.slice(0, 4)}` : ""}
        canDeleteNow={Boolean(deleteFrom) && today >= deleteFrom}
      />
    </div>
  );
}
