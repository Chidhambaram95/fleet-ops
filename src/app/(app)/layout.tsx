import { getActiveMembership } from "@data/auth/session";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import type { UserRole } from "@domain/rbac/roles";
import { AppHeader } from "@/components/layout/AppHeader";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function AppShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (!hasPublicSupabaseEnv()) {
    return <main className="mx-auto max-w-md px-4 py-5">{children}</main>;
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let role: UserRole | null = null;
  let organizationName = "Fleet";
  let displayName = user?.email ?? "";
  if (user) {
    try {
      const membership = await getActiveMembership(supabase);
      role = membership.role;
      const [{ data: organization }, { data: profile }] = await Promise.all([
        supabase
          .from("organizations")
          .select("name")
          .eq("id", membership.organizationId)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .maybeSingle(),
      ]);
      if (typeof organization?.name === "string" && organization.name.trim()) {
        organizationName = organization.name.trim();
      }
      if (typeof profile?.display_name === "string" && profile.display_name.trim()) {
        displayName = profile.display_name.trim();
      }
    } catch {
      role = null;
    }
  }

  return (
    <div className="min-h-dvh">
      <AppHeader
        organizationName={organizationName}
        email={user?.email ?? ""}
        displayName={displayName}
        role={role}
      />
      <main className="mx-auto max-w-md px-4 py-5">{children}</main>
    </div>
  );
}
