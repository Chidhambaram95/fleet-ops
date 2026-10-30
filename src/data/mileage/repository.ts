import type { SupabaseClient } from "@supabase/supabase-js";
import { listTripsWithLines } from "@data/trips/repository";
import {
  townPoints,
  tripPoints,
  type MileageBus,
  type MileagePoint,
  type TownFill,
} from "@domain/mileage/mileage";
import type { ModuleId } from "@domain/modules/modules";

function throwIfError(error: { message: string } | null) {
  if (error) {
    throw new Error(error.message);
  }
}

type BusRow = {
  id: string;
  registration_number: string;
  bus_type: string | null;
  target_kmpl?: number | string | null;
  tank_litres?: number | null;
};

type FillRow = {
  id: string;
  bus_id: string;
  entry_date: string;
  created_at: string;
  litres: number | string;
  amount_inr: number;
  odometer_km: number | null;
  full_tank: boolean;
};

/** Buses with their mileage target and tank size (both empty before migration 0024). */
export async function listMileageBuses(client: SupabaseClient, organizationId: string): Promise<MileageBus[]> {
  const full = await client
    .from("buses")
    .select("id, registration_number, bus_type, target_kmpl, tank_litres")
    .eq("organization_id", organizationId)
    .order("registration_number");
  const { data, error } = full.error
    ? await client
        .from("buses")
        .select("id, registration_number, bus_type")
        .eq("organization_id", organizationId)
        .order("registration_number")
    : full;
  throwIfError(error);
  return ((data ?? []) as BusRow[]).map((row) => ({
    id: row.id,
    registrationNumber: row.registration_number,
    busType: row.bus_type ?? "town",
    targetKmpl: row.target_kmpl == null ? null : Number(row.target_kmpl),
    tankLitres: row.tank_litres ?? null,
  }));
}

/** Town diesel entries that carry litres. Empty before migration 0024. */
export async function listTownFills(client: SupabaseClient, organizationId: string): Promise<TownFill[]> {
  const { data, error } = await client
    .from("daily_entries")
    .select("id, bus_id, entry_date, created_at, litres, amount_inr, odometer_km, full_tank")
    .eq("organization_id", organizationId)
    .eq("category", "diesel")
    .not("litres", "is", null)
    .order("entry_date", { ascending: false })
    .limit(5000);
  if (error) return [];
  return ((data ?? []) as FillRow[]).map((row) => ({
    id: row.id,
    busId: row.bus_id,
    date: row.entry_date,
    createdAt: row.created_at,
    litres: Number(row.litres),
    amountInr: row.amount_inr,
    odometerKm: row.odometer_km,
    fullTank: row.full_tank,
  }));
}

/** Keys of the alerts someone marked checked. Empty before migration 0024. */
export async function listMileageChecks(client: SupabaseClient, organizationId: string): Promise<Set<string>> {
  const { data, error } = await client
    .from("mileage_checks")
    .select("alert_key")
    .eq("organization_id", organizationId);
  if (error) return new Set();
  return new Set(((data ?? []) as { alert_key: string }[]).map((row) => row.alert_key));
}

export async function addMileageCheck(
  client: SupabaseClient,
  organizationId: string,
  input: { busId: string; alertKey: string; note?: string },
): Promise<void> {
  const { error } = await client.from("mileage_checks").insert({
    organization_id: organizationId,
    bus_id: input.busId,
    alert_key: input.alertKey,
    note: (input.note ?? "").trim(),
  });
  // Someone else marked it a moment ago: that's fine.
  if (error && !/duplicate key/i.test(error.message)) {
    throw new Error(error.message);
  }
}

export async function removeMileageCheck(
  client: SupabaseClient,
  organizationId: string,
  alertKey: string,
): Promise<void> {
  const { error } = await client
    .from("mileage_checks")
    .delete()
    .eq("organization_id", organizationId)
    .eq("alert_key", alertKey);
  throwIfError(error);
}

export type MileageData = {
  buses: MileageBus[];
  points: MileagePoint[];
  checkedKeys: Set<string>;
};

/** Everything the mileage page, card and bell need for one module. */
export async function loadMileage(
  client: SupabaseClient,
  organizationId: string,
  module: ModuleId,
): Promise<MileageData> {
  const [allBuses, checkedKeys] = await Promise.all([
    listMileageBuses(client, organizationId),
    listMileageChecks(client, organizationId),
  ]);
  const buses = allBuses.filter((bus) => bus.busType === module);
  const ids = new Set(buses.map((bus) => bus.id));
  const points =
    module === "town"
      ? townPoints(await listTownFills(client, organizationId))
      : tripPoints(await listTripsWithLines(client, organizationId, { approvedOnly: true, limit: 2000 }));
  return { buses, points: points.filter((point) => ids.has(point.busId)), checkedKeys };
}

/** The owner's expected km per litre and the tank size of one bus. Empty clears them. */
export async function updateMileageTargets(
  client: SupabaseClient,
  organizationId: string,
  busId: string,
  input: { targetKmpl: number | null; tankLitres: number | null },
): Promise<void> {
  const { data, error } = await client
    .from("buses")
    .update({ target_kmpl: input.targetKmpl, tank_litres: input.tankLitres })
    .eq("organization_id", organizationId)
    .eq("id", busId)
    .select("id");
  throwIfError(error);
  if (!data?.length) {
    throw new Error("Only an admin can change a bus.");
  }
}
