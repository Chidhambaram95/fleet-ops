import { redirect } from "next/navigation";
import { getActiveMembership } from "@data/auth/session";
import { closedCompanyName, getCompanyProfile, isSuperAdmin } from "@data/companies/repository";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { subscriptionStatus } from "@domain/billing/subscription";
import { loginLabel } from "@domain/auth/loginId";
import { FLEETOPS_WHATSAPP } from "@domain/platform/contact";
import { todayInIst } from "@domain/operations/totals";
import type { ModuleId } from "@domain/modules/modules";
import type { UserRole } from "@domain/rbac/roles";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { BillingNotice } from "@/components/billing/BillingNotice";
import { OrgProvider } from "@/components/billing/OrgContext";
import { AppHeader } from "@/components/layout/AppHeader";
import { BottomNav } from "@/components/layout/BottomNav";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { homeModule, moduleInfo } from "./moduleAccess";

const MAIN_CLASS = "mx-auto w-full max-w-6xl px-4 py-4 md:px-8 md:py-7";

export default async function AppShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (!hasPublicSupabaseEnv()) {
    return <main className={MAIN_CLASS}>{children}</main>;
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let role: UserRole | null = null;
  let organizationName = "Fleet";
  const login = loginLabel(user?.email ?? "");
  let displayName = login;
  let superAdmin = false;
  let whatsappNumber = "";
  let notice: React.ReactNode = null;
  let viewOnly = false;
  let closedCompany: string | null = null;
  let noCompany = false;
  let modules: ModuleId[] = [];
  let defaultModule: ModuleId | null = null;
  let companyArea = false;
  if (user) {
    superAdmin = await isSuperAdmin(supabase, user.id);
    if (superAdmin) {
      // The super-admin only manages companies and payments, never a fleet.
      redirect("/admin");
    }
    try {
      const membership = await getActiveMembership(supabase);
      role = membership.role;
      const [profileInfo, { data: profile }] = await Promise.all([
        getCompanyProfile(supabase, membership.organizationId),
        supabase
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .maybeSingle(),
      ]);
      organizationName = profileInfo.name;
      if (role === "admin" || role === "manager") {
        const info = await moduleInfo(membership);
        modules = info.mine;
        defaultModule = await homeModule(membership, info.mine);
        companyArea = role === "admin" || !info.limited;
      }
      whatsappNumber = profileInfo.whatsappNumber.replace(/\D/g, "");
      if (typeof profile?.display_name === "string" && profile.display_name.trim()) {
        displayName = profile.display_name.trim();
      }

      const status = subscriptionStatus(profileInfo.subscription, todayInIst());
      viewOnly = status.state === "view_only";
      notice = (
        <BillingNotice
          status={status}
          isAdminOrManager={role === "admin" || role === "manager"}
          amountInr={profileInfo.subscription?.amountInr ?? null}
          details={profileInfo.paymentDetails}
        />
      );
    } catch {
      role = null;
      closedCompany = await closedCompanyName(supabase);
      noCompany = !closedCompany;
    }
  }

  if (closedCompany) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
        <section className="flex flex-col gap-3 rounded-3xl bg-white p-6">
          <h1 className="text-xl font-extrabold">{closedCompany} is closed</h1>
          <p className="text-muted">
            This company&apos;s Fleet Ops account has been deactivated, so no one can open it. Please contact
            Fleet Ops to reopen it.
          </p>
          <SignOutButton />
        </section>
      </main>
    );
  }

  if (noCompany) {
    // Removed from their company, or the company was deleted.
    const contactUrl = `https://wa.me/${FLEETOPS_WHATSAPP.replace(/\D/g, "")}?text=${encodeURIComponent(
      `Hi Fleet Ops, I can't open my company on Fleet Ops (${login}).`,
    )}`;
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
        <section className="flex flex-col gap-3 rounded-3xl bg-white p-6">
          <h1 className="text-xl font-extrabold">You are not part of a company</h1>
          <p className="text-muted">
            This login is not linked to any company on Fleet Ops. Ask your company admin for a new invite
            link, or contact Fleet Ops.
          </p>
          <a
            href={contactUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-12 items-center justify-center rounded-2xl bg-[#1f8f4e] px-5 text-[15px] font-bold text-white"
          >
            Contact Fleet Ops on WhatsApp
          </a>
          <SignOutButton />
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-dvh pb-24 md:pb-0">
      <AppHeader
        organizationName={organizationName}
        email={login}
        displayName={displayName}
        role={role}
        isSuperAdmin={superAdmin}
        canAdd={Boolean(role) && !viewOnly}
        modules={modules}
        defaultModule={defaultModule}
        companyArea={companyArea}
      />
      {notice}
      <OrgProvider value={{ name: organizationName, whatsappNumber, viewOnly }}>
        <main className={MAIN_CLASS}>{children}</main>
      </OrgProvider>
      <BottomNav
        canAdd={Boolean(role) && !viewOnly}
        role={role}
        modules={modules}
        defaultModule={defaultModule}
      />
    </div>
  );
}
