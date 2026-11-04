import type { SupabaseClient } from "@supabase/supabase-js";

export type OffRoadReason = "breakdown" | "fc_permit" | "no_crew" | "other";

export const OFF_ROAD_REASONS: { id: OffRoadReason; label: string }[] = [
  { id: "breakdown", label: "Breakdown / repair" },
  { id: "fc_permit", label: "FC or permit" },
  { id: "no_crew", label: "No crew" },
  { id: "other", label: "Other" },
];

export type OffRoadDay = {
  id: string;
  busId: string;
  date: string;
  reason: OffRoadReason;
  note: string;
};

const REASONS = new Set(OFF_ROAD_REASONS.map((item) => item.id));

/** Days buses stood off the road between two dates. Empty before migration 0026. */
export async function listOffRoadDays(
  client: SupabaseClient,
  organizationId: string,
  range: { from: string; to: string },
): Promise<OffRoadDay[]> {
  const { data, error } = await client
    .from("bus_off_road")
    .select("id, bus_id, day, reason, note")
    .eq("organization_id", organizationId)
    .gte("day", range.from)
    .lte("day", range.to)
    .order("day", { ascending: false })
    .limit(5000);
  if (error) return [];
  return (data ?? []).map((row) => ({
    id: String(row.id),
    busId: String(row.bus_id),
    date: String(row.day),
    reason: (REASONS.has(row.reason as OffRoadReason) ? row.reason : "other") as OffRoadReason,
    note: typeof row.note === "string" ? row.note : "",
  }));
}

export async function addOffRoadDay(
  client: SupabaseClient,
  organizationId: string,
  input: { busId: string; date: string; reason: OffRoadReason; note: string },
): Promise<void> {
  const { error } = await client.from("bus_off_road").insert({
    organization_id: organizationId,
    bus_id: input.busId,
    day: input.date,
    reason: input.reason,
    note: input.note,
  });
  if (!error) return;
  if (/bus_off_road/.test(error.message) && /(does not exist|schema cache)/.test(error.message)) {
    throw new Error("Run migration 0026 on the database to mark off-road days.");
  }
  if (/duplicate|unique/i.test(error.message)) {
    throw new Error("That day is already marked off road for this bus.");
  }
  throw new Error(error.message);
}

export async function removeOffRoadDay(client: SupabaseClient, organizationId: string, id: string): Promise<void> {
  const { error } = await client.from("bus_off_road").delete().eq("organization_id", organizationId).eq("id", id);
  if (error) throw new Error(error.message);
}
