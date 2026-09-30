import { getActiveMembership, SessionError } from "@data/auth/session";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { TeamSettings } from "@/components/settings/TeamSettings";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function TeamSettingsPage() {
  if (!hasPublicSupabaseEnv()) {
    return (
      <p className="rounded-2xl bg-white px-4 py-6 text-stone-700 shadow-sm">
        Add Supabase keys to <code className="text-sm">.env.local</code> before
        managing the team.
      </p>
    );
  }

  try {
    const supabase = await createServerSupabaseClient();
    const membership = await getActiveMembership(supabase);
    if (membership.role !== "admin") {
      return (
        <p className="rounded-2xl bg-white px-4 py-6 text-stone-700 shadow-sm">
          Only admins can manage the team.
        </p>
      );
    }

    const repo = createSupabaseOperationsRepository(supabase);
    const [members, buses] = await Promise.all([
      repo.getOrganizationMembers(membership.organizationId),
      repo.listBuses(membership.organizationId),
    ]);

    return (
      <TeamSettings
        members={members}
        buses={buses}
        currentUserId={membership.userId}
      />
    );
  } catch (error) {
    const message =
      error instanceof SessionError || error instanceof Error
        ? error.message
        : "Could not load the team.";
    return (
      <p className="rounded-2xl bg-white px-4 py-6 text-red-700 shadow-sm">
        {message}
      </p>
    );
  }
}
