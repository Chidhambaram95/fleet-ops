import { redirect } from "next/navigation";
import {
  getRequestCompanyProfile,
  getRequestMembership,
  getRequestSuperAdmin,
  getRequestSupabase,
  getRequestUser,
} from "@data/auth/requestSession";
import { closedCompanyName } from "@data/companies/repository";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { subscriptionStatus } from "@domain/billing/subscription";
import { loginLabel } from "@domain/auth/loginId";
import { whatsAppChatUrl } from "@domain/platform/whatsapp";
import { FLEETOPS_WHATSAPP } from "@domain/platform/contact";
import { todayInIst } from "@domain/operations/totals";
import type { ModuleId } from "@domain/modules/modules";
import { canManage, type UserRole } from "@domain/rbac/roles";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { BillingNotice } from "@/components/billing/BillingNotice";
import { OrgProvider } from "@/components/billing/OrgContext";
import { AlertsProvider } from "@/components/alerts/AlertsProvider";
import { BottomNav } from "@/components/layout/BottomNav";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { homeModule, moduleInfo } from "./moduleAccess";

const MAIN_CLASS = "mx-auto w-full max-w-7xl px-4 py-5 lg:px-8 lg:py-8";

export default async function AppShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (!hasPublicSupabaseEnv()) {
    return <main className={MAIN_CLASS}>{children}</main>;
  }

  const supabase = await getRequestSupabase();
  const user = await getRequestUser();

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
  let organizationId = "";
  let assignedBusId = "";
  if (user) {
    superAdmin = await getRequestSuperAdmin(user.id);
    if (superAdmin) {
      // The super-admin only manages companies and payments, never a fleet.
      redirect("/admin");
    }
    try {
      const membership = await getRequestMembership();
      role = membership.role;
      organizationId = membership.organizationId;
      const [profileInfo, { data: profile }, assignment] = await Promise.all([
        getRequestCompanyProfile(membership.organizationId),
        supabase
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .maybeSingle(),
        // Crew work on one bus; the day book needs to know which, so it is not looked up again in the browser.
        membership.role === "crew"
          ? createSupabaseOperationsRepository(supabase).getCrewAssignment(
              membership.organizationId,
              membership.userId,
            ).catch(() => null)
          : Promise.resolve(null),
      ]);
      assignedBusId = assignment?.busId ?? "";
      organizationName = profileInfo.name;
      if (canManage(role)) {
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
          isAdminOrManager={canManage(role)}
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
        <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-6">
          <h1 className="text-xl font-semibold">{closedCompany} is closed</h1>
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
    const contactUrl = whatsAppChatUrl(
      FLEETOPS_WHATSAPP,
      `Hi Fleet Ops, I can't open my company on Fleet Ops (${login}).`,
    );
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
        <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-6">
          <h1 className="text-xl font-semibold">You are not part of a company</h1>
          <p className="text-muted">
            This login is not linked to any company on Fleet Ops. Ask your company admin for a new invite
            link, or contact Fleet Ops.
          </p>
          <a
            href={contactUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-12 items-center justify-center rounded-lg bg-whatsapp px-5 text-sm font-semibold text-white"
          >
            Contact Fleet Ops on WhatsApp
          </a>
          <SignOutButton />
        </section>
      </main>
    );
  }

  // Crew work from one screen, so they get no sidebar.
  const sidebar = canManage(role);
  return (
    <OrgProvider
      value={{
        name: organizationName,
        whatsappNumber,
        viewOnly,
        organizationId,
        userId: user?.id ?? "",
        role,
        modules,
        defaultModule,
        companyArea,
        assignedBusId,
      }}
    >
      <AlertsProvider>
        <div
          className={`min-h-dvh bg-canvas pb-24 text-ink md:pb-0 ${
            sidebar ? "md:grid md:grid-cols-[64px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)]" : ""
          }`}
        >
          <Sidebar />
          <div className="flex min-w-0 flex-col">
            <TopBar email={login} displayName={displayName} isSuperAdmin={superAdmin} />
            {notice}
            <main className={MAIN_CLASS}>{children}</main>
          </div>
          <BottomNav />
        </div>
      </AlertsProvider>
    </OrgProvider>
  );
}
