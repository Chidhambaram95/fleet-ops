import { getRequestCompanyProfile, getRequestMembership, getRequestSupabase } from "@data/auth/requestSession";
import { SessionError } from "@data/auth/session";
import { listPendingInvites } from "@data/companies/repository";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { listTeamLogins } from "@data/team/repository";
import { loginLabel } from "@domain/auth/loginId";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { activeModules } from "@domain/modules/modules";
import { TeamSettings } from "@/components/settings/TeamSettings";
import { canManage } from "@domain/rbac/roles";

export default async function TeamSettingsPage() {
  if (!hasPublicSupabaseEnv()) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-6 text-muted">
        Add Supabase keys to <code className="text-sm">.env.local</code> before
        managing the team.
      </p>
    );
  }

  try {
    const supabase = await getRequestSupabase();
    const membership = await getRequestMembership();
    if (!canManage(membership.role)) {
      return (
        <p className="rounded-xl border border-line bg-surface px-4 py-6 text-muted">
          Only admins and managers can open the team.
        </p>
      );
    }

    const isAdmin = membership.role === "admin";
    const repo = createSupabaseOperationsRepository(supabase);
    const [members, buses, invites, company, logins] = await Promise.all([
      repo.getOrganizationMembers(membership.organizationId),
      repo.listBuses(membership.organizationId),
      isAdmin ? listPendingInvites(supabase, membership.organizationId) : Promise.resolve([]),
      getRequestCompanyProfile(membership.organizationId),
      listTeamLogins(supabase, membership.organizationId),
    ]);

    return (
      <TeamSettings
        role={membership.role}
        logins={Object.fromEntries(
          members.map((member) => [member.userId, loginLabel(logins.get(member.userId) ?? "")]),
        )}
        members={members}
        buses={buses.filter((bus) => bus.busType !== "tour")}
        invites={invites}
        companyName={company.name}
        currentUserId={membership.userId}
        modules={activeModules(company.busTypes, company.enabledModules)}
      />
    );
  } catch (error) {
    const message =
      error instanceof SessionError || error instanceof Error
        ? error.message
        : "Could not load the team.";
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-6 text-money-out">
        {message}
      </p>
    );
  }
}
