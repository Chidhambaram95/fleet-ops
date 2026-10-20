import type { SupabaseClient } from "@supabase/supabase-js";
import { mapDailyEntry, type DailyEntryRow } from "@data/operations/mappers";
import type { DailyEntry } from "@domain/operations/types";

const PAGE = 1000;

/** Daily ledger entries between two dates (inclusive), a page at a time. */
export async function listEntriesBetween(
  client: SupabaseClient,
  organizationId: string,
  from: string,
  to: string,
): Promise<DailyEntry[]> {
  const entries: DailyEntry[] = [];
  for (let start = 0; start < 20 * PAGE; start += PAGE) {
    const { data, error } = await client
      .from("daily_entries")
      .select("id, bus_id, entry_date, kind, category, amount_inr, note, created_at")
      .eq("organization_id", organizationId)
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + PAGE - 1);
    if (error) {
      throw new Error(error.message);
    }
    const rows = (data ?? []) as DailyEntryRow[];
    entries.push(...rows.map(mapDailyEntry));
    if (rows.length < PAGE) break;
  }
  return entries;
}
