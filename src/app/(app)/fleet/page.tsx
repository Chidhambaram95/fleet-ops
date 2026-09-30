import { getActiveMembership, SessionError } from "@data/auth/session";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { FleetManager } from "@/components/operations/FleetManager";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function FleetPage() {
  if (!hasPublicSupabaseEnv()) {
    return (
      <p className="rounded-2xl bg-white px-4 py-6 text-stone-700 shadow-sm">
        Add Supabase keys to <code className="text-sm">.env.local</code> before
        managing the fleet.
      </p>
    );
  }

  try {
    const supabase = await createServerSupabaseClient();
    const membership = await getActiveMembership(supabase);
    if (membership.role !== "admin") {
      return (
        <p className="rounded-2xl bg-white px-4 py-6 text-stone-700 shadow-sm">
          Only admins can manage the fleet.
        </p>
      );
    }
    return <FleetManager />;
  } catch (error) {
    const message =
      error instanceof SessionError || error instanceof Error
        ? error.message
        : "Could not load the fleet.";
    return (
      <p className="rounded-2xl bg-white px-4 py-6 text-red-700 shadow-sm">
        {message}
      </p>
    );
  }
}
