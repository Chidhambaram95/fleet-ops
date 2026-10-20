"use server";

import { revalidatePath } from "next/cache";
import { getActiveMembership } from "@data/auth/session";
import { cancelInvite, createInvite } from "@data/companies/repository";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { isUserRole } from "@domain/rbac/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { friendlyErrorMessage } from "@domain/platform/errors";

async function requireAdmin() {
  const supabase = await createServerSupabaseClient();
  const membership = await getActiveMembership(supabase);
  if (membership.role !== "admin") {
    throw new Error("Only admins can manage the team.");
  }
  return { supabase, membership };
}

function messageFromUnknown(error: unknown) {
  return friendlyErrorMessage(error);
}

export async function createInviteAction(input: {
  displayName: string;
  whatsappNumber: string;
  role: string;
  busId: string;
}) {
  try {
    const displayName = input.displayName.trim();
    if (!displayName) {
      return { error: "Enter a name." };
    }
    if (!isUserRole(input.role)) {
      return { error: "Choose a valid role." };
    }
    if (input.role === "crew" && !input.busId) {
      return { error: "Choose a vehicle for this crew member." };
    }

    const { supabase, membership } = await requireAdmin();
    const token = await createInvite(supabase, {
      organizationId: membership.organizationId,
      role: input.role,
      displayName,
      whatsappNumber: input.whatsappNumber.trim(),
      busId: input.role === "crew" ? input.busId : null,
    });
    revalidatePath("/settings/team");
    return { token };
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

export async function cancelInviteAction(inviteId: string) {
  try {
    const { supabase } = await requireAdmin();
    await cancelInvite(supabase, inviteId);
    revalidatePath("/settings/team");
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
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
    // The bus first: the database refuses crew without one.
    await repo.assignCrewToBus(membership.organizationId, userId, busId);
    await repo.updateMemberRole(membership.organizationId, userId, "crew");
    revalidatePath("/settings/team");
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}
