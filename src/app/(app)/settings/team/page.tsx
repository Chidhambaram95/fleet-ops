import { getActiveMembership, SessionError } from "@data/auth/session";
import { getCompanyProfile, listPendingInvites } from "@data/companies/repository";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { listTeamLogins } from "@data/team/repository";
import { loginLabel } from "@domain/auth/loginId";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { activeModules } from "@domain/modules/modules";
import { TeamSettings } from "@/components/settings/TeamSettings";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function TeamSettingsPage() {
  if (!hasPublicSupabaseEnv()) {
    return (
      <p className="rounded-3xl bg-white px-4 py-6 text-muted">
        Add Supabase keys to <code className="text-sm">.env.local</code> before
        managing the team.
      </p>
    );
  }

  try {
    const supabase = await createServerSupabaseClient();
    const membership = await getActiveMembership(supabase);
    if (membership.role !== "admin" && membership.role !== "manager") {
      return (
        <p className="rounded-3xl bg-white px-4 py-6 text-muted">
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
      getCompanyProfile(supabase, membership.organizationId),
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
      <p className="rounded-3xl bg-white px-4 py-6 text-money-out">
        {message}
      </p>
    );
  }
}
