"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { getActiveMembership } from "@data/auth/session";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { getPublicSupabaseEnv } from "@data/supabase/env";
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

export async function createMemberAction(input: {
  displayName: string;
  email: string;
  password: string;
  role: string;
  busId: string;
}) {
  try {
    const displayName = input.displayName.trim();
    const email = input.email.trim().toLowerCase();
    const password = input.password;
    if (!displayName) {
      return { error: "Enter a name." };
    }
    if (!email.includes("@")) {
      return { error: "Enter a valid email." };
    }
    if (password.length < 6) {
      return { error: "Password must be at least 6 characters." };
    }
    if (!isUserRole(input.role)) {
      return { error: "Choose a valid role." };
    }
    if (input.role === "crew" && !input.busId) {
      return { error: "Choose a vehicle for this crew member." };
    }

    const { supabase, membership } = await requireAdmin();
    const userId = await createAuthUser(email, password, displayName);
    const repo = createSupabaseOperationsRepository(supabase);
    await repo.addOrganizationMember(
      membership.organizationId,
      userId,
      input.role,
    );
    if (input.role === "crew") {
      await repo.assignCrewToBus(membership.organizationId, userId, input.busId);
    }
    revalidatePath("/settings/team");
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

async function createAuthUser(email: string, password: string, displayName: string) {
  const { url, anonKey } = getPublicSupabaseEnv();
  const authClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await authClient.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) {
    throw new Error(error.message);
  }
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    throw new Error("An account with that email already exists.");
  }
  if (!data.user?.id) {
    throw new Error("Could not create that account.");
  }
  return data.user.id;
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
