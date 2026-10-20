import { getActiveMembership, type ActiveMembership } from "@data/auth/session";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Trips, money, renewals and reports are for admins and managers. Returns the membership, or a message to show. */
export async function editorAccess(): Promise<
  { membership: ActiveMembership; message?: never } | { membership?: never; message: string }
> {
  if (!hasPublicSupabaseEnv()) {
    return { message: "Add Supabase keys to .env.local first." };
  }
  try {
    const membership = await getActiveMembership(await createServerSupabaseClient());
    if (membership.role === "crew") {
      return { message: "Only admins and managers can open this page." };
    }
    return { membership };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Could not load this page." };
  }
}

export function AccessMessage({ message }: { message: string }) {
  return <p className="rounded-3xl bg-white px-4 py-6 text-muted">{message}</p>;
}
