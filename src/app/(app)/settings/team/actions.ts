"use server";

import { revalidatePath } from "next/cache";
import { getActiveMembership } from "@data/auth/session";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { isUserRole } from "@domain/rbac/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createServerSupabaseClient();
  const membership = await getActiveMembership(supabase);
  if (membership.role !== "admin") {
    throw new Error("Only admins can manage the team.");
  }
  return { supabase, membership };
}

function messageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export async function updateMemberRoleAction(userId: string, role: string) {
  try {
    if (!isUserRole(role)) {
      return { error: "Choose a valid role." };
    }
    const { supabase, membership } = await requireAdmin();
    if (userId === membership.userId) {
      return { error: "You cannot change your own role." };
    }
    const repo = createSupabaseOperationsRepository(supabase);
    await repo.updateMemberRole(membership.organizationId, userId, role);
    revalidatePath("/settings/team");
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

export async function assignCrewToBusAction(userId: string, busId: string) {
  try {
    if (!busId) {
      return { error: "Choose a vehicle for this crew member." };
    }
    const { supabase, membership } = await requireAdmin();
    if (userId === membership.userId) {
      return { error: "You cannot change your own role." };
    }
    const repo = createSupabaseOperationsRepository(supabase);
    await repo.updateMemberRole(membership.organizationId, userId, "crew");
    await repo.assignCrewToBus(membership.organizationId, userId, busId);
    revalidatePath("/settings/team");
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}
