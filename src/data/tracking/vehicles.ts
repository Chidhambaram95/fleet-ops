import type { SupabaseClient } from "@supabase/supabase-js";
import type { Vehicle } from "@domain/tracking/types";

export async function listVehicles(
  client: SupabaseClient,
): Promise<Vehicle[]> {
  const { data, error } = await client
    .from("vehicles")
    .select(
      "id, registration_number, status, last_known_lat, last_known_lng, updated_at",
    )
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    registrationNumber: row.registration_number,
    status: row.status,
    lastKnownLat: row.last_known_lat,
    lastKnownLng: row.last_known_lng,
    updatedAt: row.updated_at,
  }));
}
