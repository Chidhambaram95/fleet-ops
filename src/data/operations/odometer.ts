import type { SupabaseClient } from "@supabase/supabase-js";

/** Notes the km on a bus. The database refuses a reading below the last one. */
export async function addOdometerReading(
  client: SupabaseClient,
  organizationId: string,
  busId: string,
  odometerKm: number,
): Promise<void> {
  if (!Number.isInteger(odometerKm) || odometerKm < 0) {
    throw new Error("Enter the odometer in km.");
  }
  const { error } = await client.from("odometer_readings").insert({
    organization_id: organizationId,
    bus_id: busId,
    odometer_km: odometerKm,
  });
  if (error) {
    throw new Error(error.message);
  }
}
