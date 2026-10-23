"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedUserId } from "@data/auth/session";
import {
  createCompany,
  createInvite,
  deleteCompanyForGood,
  isSuperAdmin,
  removeMember,
  setCompanyActive,
  setMemberRole,
  updateCompanyAsAdmin,
  recordPayment,
  updatePlatformPaymentDetails,
  updateSubscription,
} from "@data/companies/repository";
import { BUS_TYPES, type BusType } from "@domain/companies/types";
import { prepareCompanyLogin, setLoginPassword } from "@data/auth/directLogin";
import { addMemberDirect, canSetMemberPassword } from "@data/team/repository";
import { loginLabel, parseLoginId, passwordProblem } from "@domain/auth/loginId";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function requireSuperAdmin() {
  const supabase = await createServerSupabaseClient();
  const userId = await getAuthenticatedUserId(supabase);
  if (!(await isSuperAdmin(supabase, userId))) {
    throw new Error("Only the super-admin can do this.");
  }
  return supabase;
}

function messageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function createCompanyAction(input: {
  name: string;
  town: string;
  busTypes: string[];
  gstin: string;
  adminName: string;
  adminWhatsapp: string;
}) {
  try {
    const name = input.name.trim();
    if (!name) return { error: "Enter the company name." };
    if (!input.adminName.trim()) return { error: "Enter the admin's name." };
    const busTypes = input.busTypes.filter((type): type is BusType =>
      (BUS_TYPES as readonly string[]).includes(type),
    );
    if (busTypes.length === 0) return { error: "Choose at least one bus type." };

    const supabase = await requireSuperAdmin();
    const result = await createCompany(supabase, {
      name,
      town: input.town.trim(),
      busTypes,
      gstin: input.gstin.trim().toUpperCase(),
      adminName: input.adminName.trim(),
      adminWhatsapp: input.adminWhatsapp.trim(),
    });
    revalidatePath("/admin/companies");
    return { token: result.token };
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

export async function extendTrialAction(organizationId: string, trialEndsOn: string) {
  try {
    if (!ISO_DATE.test(trialEndsOn)) return { error: "Choose a valid date." };
    const supabase = await requireSuperAdmin();
    await updateSubscription(supabase, organizationId, { trialEndsOn });
    revalidatePath("/admin/payments");
    revalidatePath("/admin/companies");
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

export async function updatePlanAction(
  organizationId: string,
  input: { amountInr: string; billingPeriod: string },
) {
  try {
    const amount = input.amountInr.trim() === "" ? null : Number(input.amountInr);
    if (amount !== null && (!Number.isInteger(amount) || amount < 0)) {
      return { error: "Enter the amount in whole rupees." };
    }
    if (!["month", "quarter", "year"].includes(input.billingPeriod)) {
      return { error: "Choose month, quarter or year." };
    }
    const supabase = await requireSuperAdmin();
    await updateSubscription(supabase, organizationId, {
      amountInr: amount,
      billingPeriod: input.billingPeriod as "month" | "quarter" | "year",
    });
    revalidatePath("/admin/payments");
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

export async function markPaymentReceivedAction(
  organizationId: string,
  input: {
    paidOn: string;
    amountInr: string;
    mode: string;
    reference: string;
    paidUntil: string;
  },
) {
  try {
    const amount = Number(input.amountInr);
    if (!Number.isInteger(amount) || amount < 0) {
      return { error: "Enter the amount received in whole rupees." };
    }
    if (!ISO_DATE.test(input.paidOn) || !ISO_DATE.test(input.paidUntil)) {
      return { error: "Choose the dates." };
    }
    if (!["upi", "bank", "cash", "other"].includes(input.mode)) {
      return { error: "Choose how it was paid." };
    }
    const supabase = await requireSuperAdmin();
    await recordPayment(supabase, {
      organizationId,
      paidOn: input.paidOn,
      amountInr: amount,
      mode: input.mode,
      reference: input.reference.trim(),
      paidUntil: input.paidUntil,
    });
    revalidatePath("/admin/payments");
    revalidatePath("/admin/companies");
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

export async function savePaymentDetailsAction(input: {
  accountName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  upiId: string;
}) {
  try {
    const supabase = await requireSuperAdmin();
    await updatePlatformPaymentDetails(supabase, {
      accountName: input.accountName.trim(),
      bankName: input.bankName.trim(),
      accountNumber: input.accountNumber.trim(),
      ifsc: input.ifsc.trim().toUpperCase(),
      upiId: input.upiId.trim(),
    });
    revalidatePath("/admin/payments");
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

function revalidateCompany(organizationId: string) {
  revalidatePath("/admin/companies");
  revalidatePath(`/admin/companies/${organizationId}`);
  revalidatePath("/admin/payments");
}

export async function updateCompanyAction(
  organizationId: string,
  input: {
    name: string;
    town: string;
    gstin: string;
    whatsappNumber: string;
    busTypes: string[];
    maxBuses: string;
  },
) {
  try {
    const name = input.name.trim();
    if (!name) return { error: "Enter the company name." };
    const busTypes = input.busTypes.filter((type): type is BusType =>
      (BUS_TYPES as readonly string[]).includes(type),
    );
    if (busTypes.length === 0) return { error: "Choose at least one bus type." };
    const maxBuses = input.maxBuses.trim() === "" ? null : Number(input.maxBuses);
    if (maxBuses !== null && (!Number.isInteger(maxBuses) || maxBuses < 0)) {
      return { error: "Enter the bus limit as a whole number, or leave it empty for no limit." };
    }
    const supabase = await requireSuperAdmin();
    await updateCompanyAsAdmin(supabase, organizationId, {
      name,
      town: input.town.trim(),
      gstin: input.gstin.trim().toUpperCase(),
      whatsappNumber: input.whatsappNumber.trim(),
      busTypes,
      maxBuses,
    });
    revalidateCompany(organizationId);
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

export async function inviteAdminAction(
  organizationId: string,
  input: { name: string; whatsapp: string; role: string },
) {
  try {
    if (!input.name.trim()) return { error: "Enter the person's name." };
    if (!["admin", "manager"].includes(input.role)) return { error: "Choose admin or manager." };
    const supabase = await requireSuperAdmin();
    const token = await createInvite(supabase, {
      organizationId,
      role: input.role,
      displayName: input.name.trim(),
      whatsappNumber: input.whatsapp.trim(),
      busId: null,
    });
    revalidateCompany(organizationId);
    return { token };
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

/** Adds an admin or manager with a login and password: no invite link. */
export async function addPersonDirectAction(
  organizationId: string,
  input: { name: string; loginId: string; password: string; role: string },
) {
  try {
    const name = input.name.trim();
    if (!name) return { error: "Enter the person's name." };
    if (!["admin", "manager"].includes(input.role)) return { error: "Choose admin or manager." };
    const login = parseLoginId(input.loginId);
    if (!login) return { error: "Enter an email address or a 10-digit mobile number." };
    const weak = passwordProblem(input.password);
    if (weak) return { error: weak };
    const supabase = await requireSuperAdmin();
    const userId = await prepareCompanyLogin(createServiceSupabaseClient(), {
      organizationId,
      login,
      password: input.password,
      displayName: name,
    });
    await addMemberDirect(supabase, { organizationId, userId, role: input.role, busId: null, displayName: name });
    revalidateCompany(organizationId);
    return { login: loginLabel(login.email) };
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

export async function setPersonPasswordAction(organizationId: string, userId: string, password: string) {
  try {
    const weak = passwordProblem(password);
    if (weak) return { error: weak };
    const supabase = await requireSuperAdmin();
    if (!(await canSetMemberPassword(supabase, organizationId, userId))) {
      return { error: "This person is not in this company." };
    }
    await setLoginPassword(createServiceSupabaseClient(), userId, password);
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

export async function setMemberRoleAction(organizationId: string, userId: string, role: string) {
  try {
    const supabase = await requireSuperAdmin();
    await setMemberRole(supabase, organizationId, userId, role);
    revalidateCompany(organizationId);
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

export async function removeMemberAction(organizationId: string, userId: string) {
  try {
    const supabase = await requireSuperAdmin();
    await removeMember(supabase, organizationId, userId);
    revalidateCompany(organizationId);
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

export async function setCompanyActiveAction(organizationId: string, active: boolean) {
  try {
    const supabase = await requireSuperAdmin();
    await setCompanyActive(supabase, organizationId, active);
    revalidateCompany(organizationId);
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}

export async function deleteCompanyAction(organizationId: string, confirmName: string) {
  try {
    const supabase = await requireSuperAdmin();
    await deleteCompanyForGood(supabase, organizationId, confirmName);
    revalidatePath("/admin/companies");
    revalidatePath("/admin/payments");
    return {};
  } catch (error) {
    return { error: messageFromUnknown(error) };
  }
}
