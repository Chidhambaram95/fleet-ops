"use server";

import { revalidatePath } from "next/cache";
import { getActiveMembership } from "@data/auth/session";
import { cancelInvite, createInvite } from "@data/companies/repository";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { isModuleId } from "@domain/modules/modules";
import { isUserRole } from "@domain/rbac/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { prepareCompanyLogin, setLoginPassword } from "@data/auth/directLogin";
import { addMemberDirect, canSetMemberPassword, removeCompanyMember } from "@data/team/repository";
import { loginLabel, parseLoginId, passwordProblem } from "@domain/auth/loginId";
import { friendlyErrorMessage } from "@domain/platform/errors";

async function requireAdmin() {
  const supabase = await createServerSupabaseClient();
  const membership = await getActiveMembership(supabase);
  if (membership.role !== "admin") {
    throw new Error("Only admins can manage the team.");
  }
  return { supabase, membership };
}

/** Managers open the Team page too, to remove crew. */
async function requireAdminOrManager() {
  const supabase = await createServerSupabaseClient();
  const membership = await getActiveMembership(supabase);
  if (membership.role !== "admin" && membership.role !== "manager") {
    throw new Error("Only admins and managers can manage the team.");
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

/** Limits a manager to one module, or (empty) lets them open every module. */
export async function updateMemberModuleAction(userId: string, module: string) {
  try {
    if (module && !isModuleId(module)) {
      return { error: "Choose a valid module." };
    }
    const { supabase, membership } = await requireAdmin();
    const repo = createSupabaseOperationsRepository(supabase);
    await repo.updateMemberModule(membership.organizationId, userId, isModuleId(module) ? module : null);
    revalidatePath("/settings/team");
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

/** Adds a person straight away: their login is an email or a phone number. */
export async function addMemberDirectAction(input: {
  displayName: string;
  loginId: string;
  password: string;
  role: string;
  busId: string;
}) {
  try {
    const displayName = input.displayName.trim();
    if (!displayName) return { error: "Enter a name." };
    const login = parseLoginId(input.loginId);
    if (!login) return { error: "Enter an email address or a 10-digit mobile number." };
    const weak = passwordProblem(input.password);
    if (weak) return { error: weak };
    if (!isUserRole(input.role)) return { error: "Choose a valid role." };
    if (input.role === "crew" && !input.busId) {
      return { error: "Choose a vehicle for this crew member." };
    }

    const { supabase, membership } = await requireAdmin();
    const userId = await prepareCompanyLogin(createServiceSupabaseClient(), {
      organizationId: membership.organizationId,
      login,
      password: input.password,
      displayName,
    });
    await addMemberDirect(supabase, {
      organizationId: membership.organizationId,
      userId,
      role: input.role,
      busId: input.role === "crew" ? input.busId : null,
      displayName,
    });
    revalidatePath("/settings/team");
    return { login: loginLabel(login.email) };
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

export async function removeMemberAction(userId: string) {
  try {
    const { supabase, membership } = await requireAdminOrManager();
    await removeCompanyMember(supabase, membership.organizationId, userId);
    revalidatePath("/settings/team");
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

/** An admin sets a new password for a manager or crew member. */
export async function setMemberPasswordAction(userId: string, password: string) {
  try {
    const weak = passwordProblem(password);
    if (weak) return { error: weak };
    const { supabase, membership } = await requireAdmin();
    if (!(await canSetMemberPassword(supabase, membership.organizationId, userId))) {
      return { error: "You can set passwords only for managers and crew in your company." };
    }
    await setLoginPassword(createServiceSupabaseClient(), userId, password);
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}
