import type { Metadata } from "next";
import { getRequestMembership, getRequestSupabase } from "@data/auth/requestSession";
import { SessionError } from "@data/auth/session";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { HistoryBoard } from "@/components/history/HistoryBoard";
import { canManage } from "@domain/rbac/roles";

export const metadata: Metadata = {
  title: "Change history · Fleet Ops",
};

export default async function HistoryPage() {
  if (!hasPublicSupabaseEnv()) {
    return <p className="rounded-3xl bg-white px-4 py-6 text-muted">Add Supabase keys to see the history.</p>;
  }
  try {
    const supabase = await getRequestSupabase();
    const membership = await getRequestMembership();
    if (!canManage(membership.role)) {
      return (
        <p className="rounded-3xl bg-white px-4 py-6 text-muted">
          Only admins and managers can see the change history.
        </p>
      );
    }
    const buses = await createSupabaseOperationsRepository(supabase).listBuses(membership.organizationId);
    return (
      <HistoryBoard
        organizationId={membership.organizationId}
        role={membership.role}
        busNames={Object.fromEntries(buses.map((bus) => [bus.id, bus.registrationNumber]))}
      />
    );
  } catch (error) {
    const message =
      error instanceof SessionError || error instanceof Error ? error.message : "Could not load the history.";
    return <p className="rounded-3xl bg-white px-4 py-6 text-money-out">{message}</p>;
  }
}
