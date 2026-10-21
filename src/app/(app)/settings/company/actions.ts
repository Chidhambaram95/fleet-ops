"use server";

import { revalidatePath } from "next/cache";
import { getActiveMembership } from "@data/auth/session";
import { getCompanyProfile, updateCompanyProfile } from "@data/companies/repository";
import { BUS_TYPES, type BusType } from "@domain/companies/types";
import { friendlyErrorMessage } from "@domain/platform/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function saveCompanyAction(input: {
  name: string;
  town: string;
  gstin: string;
  whatsappNumber: string;
  /** Modules switched on, from those the super admin allows. */
  enabledModules: string[];
}) {
  try {
    const name = input.name.trim();
    if (!name) return { error: "Enter the company name." };
    const picked = input.enabledModules.filter((type): type is BusType =>
      (BUS_TYPES as readonly string[]).includes(type),
    );
    const digits = input.whatsappNumber.replace(/\D/g, "");
    if (digits && digits.length < 10) {
      return { error: "Enter a WhatsApp number with at least 10 digits." };
    }

    const supabase = await createServerSupabaseClient();
    const membership = await getActiveMembership(supabase);
    if (membership.role !== "admin") {
      return { error: "Only admins can change company settings." };
    }
    const { busTypes: allowed } = await getCompanyProfile(supabase, membership.organizationId);
    const enabledModules = BUS_TYPES.filter((type) => allowed.includes(type) && picked.includes(type));
    if (enabledModules.length === 0) return { error: "Keep at least one bus type switched on." };
    await updateCompanyProfile(supabase, membership.organizationId, {
      name,
      town: input.town.trim(),
      gstin: input.gstin.trim().toUpperCase(),
      whatsappNumber: digits.length === 10 ? `91${digits}` : digits,
      enabledModules,
    });
    revalidatePath("/", "layout");
    return {};
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
}
