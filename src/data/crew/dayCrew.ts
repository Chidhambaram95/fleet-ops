import type { SupabaseClient } from "@supabase/supabase-js";
import type { DayCrewRow } from "@domain/crew/dayCrew";
import type { CrewJob } from "@domain/money/types";

/** The Town crew on duty on one day, for every bus of the company. */
export async function listDayCrew(
  client: SupabaseClient,
  organizationId: string,
  day: string,
): Promise<DayCrewRow[]> {
  const { data, error } = await client
    .from("day_crew")
    .select("id, day, bus_id, duty, person_id")
    .eq("organization_id", organizationId)
    .eq("day", day);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    day: String(row.day),
    busId: String(row.bus_id),
    duty: row.duty as CrewJob,
    personId: String(row.person_id),
  }));
}

/** Puts a person on a bus for the day, or clears the job when personId is empty. */
export async function setDayCrew(
  client: SupabaseClient,
  organizationId: string,
  day: string,
  busId: string,
  duty: CrewJob,
  personId: string,
): Promise<void> {
  const { error } = personId
    ? await client
        .from("day_crew")
        .upsert(
          { organization_id: organizationId, day, bus_id: busId, duty, person_id: personId },
          { onConflict: "bus_id,day,duty" },
        )
    : await client
        .from("day_crew")
        .delete()
        .eq("organization_id", organizationId)
        .eq("bus_id", busId)
        .eq("day", day)
        .eq("duty", duty);
  if (error) {
    throw new Error(error.message);
  }
}
