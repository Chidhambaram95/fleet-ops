import { redirect } from "next/navigation";
import { getActiveMembership } from "@data/auth/session";
import { getCompanyProfile, isSuperAdmin } from "@data/companies/repository";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { subscriptionStatus } from "@domain/billing/subscription";
import { todayInIst } from "@domain/operations/totals";
import type { UserRole } from "@domain/rbac/roles";
import { BillingNotice } from "@/components/billing/BillingNotice";
import { OrgProvider } from "@/components/billing/OrgContext";
import { AppHeader } from "@/components/layout/AppHeader";
import { BottomNav } from "@/components/layout/BottomNav";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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
  let displayName = user?.email ?? "";
  let superAdmin = false;
  let whatsappNumber = "";
  let notice: React.ReactNode = null;
  let viewOnly = false;
  if (user) {
    superAdmin = await isSuperAdmin(supabase, user.id);
    if (superAdmin) {
      // A super-admin with no company of their own works from the console.
      const { count } = await supabase
        .from("organization_members")
        .select("organization_id", { count: "exact", head: true })
        .eq("user_id", user.id);
      if (!count) {
        redirect("/admin");
      }
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
    }
  }

  return (
    <div className="min-h-dvh pb-24 md:pb-0">
      <AppHeader
        organizationName={organizationName}
        email={user?.email ?? ""}
        displayName={displayName}
        role={role}
        isSuperAdmin={superAdmin}
        canAdd={Boolean(role) && !viewOnly}
      />
      {notice}
      <OrgProvider value={{ name: organizationName, whatsappNumber, viewOnly }}>
        <main className={MAIN_CLASS}>{children}</main>
      </OrgProvider>
      <BottomNav canAdd={Boolean(role) && !viewOnly} />
    </div>
  );
}
