import { getActiveMembership, SessionError } from "@data/auth/session";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { FleetManager } from "@/components/operations/FleetManager";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function FleetPage() {
  if (!hasPublicSupabaseEnv()) {
    return (
      <p className="rounded-3xl bg-white px-4 py-6 text-muted">
        Add Supabase keys to <code className="text-sm">.env.local</code> before
        managing the fleet.
      </p>
    );
  }

  try {
    const supabase = await createServerSupabaseClient();
    const membership = await getActiveMembership(supabase);
    if (membership.role === "crew") {
      return (
        <p className="rounded-3xl bg-white px-4 py-6 text-muted">
          Only admins and managers can see the bus list.
        </p>
      );
    }
    return <FleetManager canEdit={membership.role === "admin"} />;
  } catch (error) {
    const message =
      error instanceof SessionError || error instanceof Error
        ? error.message
        : "Could not load the fleet.";
    return (
      <p className="rounded-3xl bg-white px-4 py-6 text-money-out">
        {message}
      </p>
    );
  }
}
