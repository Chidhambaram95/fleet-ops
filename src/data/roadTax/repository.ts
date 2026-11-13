import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isValidChassisLast5,
  normalizeChassisLast5,
} from "@domain/roadTax/vahan";

/** Owner name as on the RC and chassis last 5, kept on each bus for paying road tax on Vahan. */
export type BusVahanDetails = {
  ownerName: string;
  chassisLast5: string;
};

const MISSING_0028 = /(owner_name|chassis_last5).*(does not exist|schema cache)|(does not exist|schema cache).*(owner_name|chassis_last5)/;
export const MIGRATION_0028_MESSAGE = "Run migration 0028 on the database to save the owner name and chassis number.";

type Row = { id: string; owner_name: string | null; chassis_last5: string | null };

/**
 * Owner and chassis for every bus of the company, by bus id. Read separately
 * from the bus list so the other pages keep working on a database without 0028.
 */
export async function listBusVahanDetails(
  client: SupabaseClient,
  organizationId: string,
): Promise<{ details: Map<string, BusVahanDetails>; migrated: boolean }> {
  const { data, error } = await client
    .from("buses")
    .select("id, owner_name, chassis_last5")
    .eq("organization_id", organizationId);
  if (error) {
    if (MISSING_0028.test(error.message)) return { details: new Map(), migrated: false };
    throw new Error(error.message);
  }
  const details = new Map<string, BusVahanDetails>();
  for (const row of (data ?? []) as Row[]) {
    details.set(row.id, { ownerName: row.owner_name ?? "", chassisLast5: row.chassis_last5 ?? "" });
  }
  return { details, migrated: true };
}

/** Cleans and checks what was typed: owner trimmed with single spaces, chassis upper case. */
export function cleanBusVahanDetails(input: BusVahanDetails): BusVahanDetails {
  const ownerName = input.ownerName.replace(/\s+/g, " ").trim();
  const chassisLast5 = normalizeChassisLast5(input.chassisLast5);
  if (ownerName.length > 120) throw new Error("Owner name is too long (120 letters at most).");
  if (chassisLast5 && !isValidChassisLast5(chassisLast5)) {
    throw new Error("Chassis number: enter exactly the last 5 letters or digits.");
  }
  return { ownerName, chassisLast5 };
}

/** Admins only (the existing bus rules). */
export async function updateBusVahanDetails(
  client: SupabaseClient,
  organizationId: string,
  busId: string,
  input: BusVahanDetails,
): Promise<BusVahanDetails> {
  const clean = cleanBusVahanDetails(input);
  const { data, error } = await client
    .from("buses")
    .update({ owner_name: clean.ownerName, chassis_last5: clean.chassisLast5 })
    .eq("organization_id", organizationId)
    .eq("id", busId)
    .select("id");
  if (error) {
    throw new Error(MISSING_0028.test(error.message) ? MIGRATION_0028_MESSAGE : error.message);
  }
  if (!data?.length) throw new Error("Could not save the owner and chassis for that bus.");
  return clean;
}
