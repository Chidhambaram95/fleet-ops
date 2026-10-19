"use server";

import { revalidatePath } from "next/cache";
import { getActiveMembership } from "@data/auth/session";
import { updateCompanyProfile } from "@data/companies/repository";
import { BUS_TYPES, type BusType } from "@domain/companies/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function saveCompanyAction(input: {
  name: string;
  town: string;
  gstin: string;
  whatsappNumber: string;
  busTypes: string[];
}) {
  try {
    const name = input.name.trim();
    if (!name) return { error: "Enter the company name." };
    const busTypes = input.busTypes.filter((type): type is BusType =>
      (BUS_TYPES as readonly string[]).includes(type),
    );
    if (busTypes.length === 0) return { error: "Choose at least one bus type." };
    const digits = input.whatsappNumber.replace(/\D/g, "");
    if (digits && digits.length < 10) {
      return { error: "Enter a WhatsApp number with at least 10 digits." };
    }

    const supabase = await createServerSupabaseClient();
    const membership = await getActiveMembership(supabase);
    if (membership.role !== "admin") {
      return { error: "Only admins can change company settings." };
    }
    await updateCompanyProfile(supabase, membership.organizationId, {
      name,
      town: input.town.trim(),
      gstin: input.gstin.trim().toUpperCase(),
      whatsappNumber: digits.length === 10 ? `91${digits}` : digits,
      busTypes,
    });
    revalidatePath("/", "layout");
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }
}
