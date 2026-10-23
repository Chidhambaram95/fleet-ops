import type { SupabaseClient } from "@supabase/supabase-js";
import type { HistoryRow } from "@domain/history/types";

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export type DayLock = { frozen: boolean; closed: boolean; openUntil: string | null };
export type TripLock = { frozen: boolean; openUntil: string | null };

/** Whether a day is closed, and until when this person opened it. */
export async function getDayLock(client: SupabaseClient, organizationId: string, day: string): Promise<DayLock> {
  const { data, error } = await client.rpc("day_lock_status", { p_org: organizationId, p_day: day });
  fail(error);
  const row = (data ?? [])[0] as { frozen: boolean; closed: boolean; open_until: string | null } | undefined;
  return { frozen: Boolean(row?.frozen), closed: Boolean(row?.closed), openUntil: row?.open_until ?? null };
}

export async function getTripLock(client: SupabaseClient, organizationId: string, tripId: string): Promise<TripLock> {
  const { data, error } = await client.rpc("trip_lock_status", { p_org: organizationId, p_trip: tripId });
  fail(error);
  const row = (data ?? [])[0] as { frozen: boolean; open_until: string | null } | undefined;
  return { frozen: Boolean(row?.frozen), openUntil: row?.open_until ?? null };
}

export async function closeDay(client: SupabaseClient, organizationId: string, day: string) {
  const { error } = await client.rpc("close_day", { p_org: organizationId, p_day: day });
  fail(error);
}

/** Opens a closed day, or one trip sheet, for 30 minutes. The comment is kept in the history. */
export async function openForEdit(
  client: SupabaseClient,
  organizationId: string,
  target: { day: string } | { tripId: string },
  reason: string,
) {
  const { data, error } = await client.rpc("open_for_edit", {
    p_org: organizationId,
    p_day: "day" in target ? target.day : null,
    p_trip: "tripId" in target ? target.tripId : null,
    p_reason: reason,
  });
  fail(error);
  return data as string;
}

const HISTORY_COLUMNS =
  "id, table_name, row_id, action, bus_id, module, changed_by, changed_at, reason, old_data, new_data";

type AuditRecord = {
  id: number;
  table_name: string;
  row_id: string | null;
  action: string;
  bus_id: string | null;
  module: string | null;
  changed_by: string | null;
  changed_at: string;
  reason: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
};

async function withNames(client: SupabaseClient, rows: AuditRecord[]): Promise<HistoryRow[]> {
  const ids = [...new Set(rows.map((row) => row.changed_by).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await client.from("profiles").select("id, display_name").in("id", ids);
    for (const profile of (data ?? []) as { id: string; display_name: string | null }[]) {
      if (profile.display_name) names.set(profile.id, profile.display_name);
    }
  }
  return rows.map((row) => ({
    id: row.id,
    table: row.table_name,
    rowId: row.row_id,
    action: row.action as HistoryRow["action"],
    busId: row.bus_id,
    module: row.module,
    changedBy: row.changed_by,
    changedByName: row.changed_by ? (names.get(row.changed_by) ?? "") : "",
    changedAt: row.changed_at,
    reason: row.reason ?? "",
    oldData: row.old_data,
    newData: row.new_data,
  }));
}

/** Newest changes first. `before` is the id of the last row already shown. */
export async function listHistory(
  client: SupabaseClient,
  organizationId: string,
  options: { before?: number; limit?: number; module?: string; table?: string } = {},
) {
  let query = client
    .from("audit_log")
    .select(HISTORY_COLUMNS)
    .eq("organization_id", organizationId)
    .order("id", { ascending: false })
    .limit(options.limit ?? 30);
  if (options.before) query = query.lt("id", options.before);
  if (options.module) query = query.eq("module", options.module);
  if (options.table) query = query.eq("table_name", options.table);
  const { data, error } = await query;
  fail(error);
  return withNames(client, (data ?? []) as AuditRecord[]);
}

/** The latest change to one day's cash entries, or to one trip sheet. */
export async function lastChange(
  client: SupabaseClient,
  organizationId: string,
  target: { day: string; module?: string } | { tripId: string },
) {
  let query = client
    .from("audit_log")
    .select(HISTORY_COLUMNS)
    .eq("organization_id", organizationId)
    .order("id", { ascending: false })
    .limit(1);
  if ("tripId" in target) {
    query = query.eq("table_name", "trips").eq("row_id", target.tripId);
  } else {
    query = query
      .eq("table_name", "daily_entries")
      .or(`new_data->>entry_date.eq.${target.day},old_data->>entry_date.eq.${target.day}`);
    if (target.module) query = query.eq("module", target.module);
  }
  const { data, error } = await query;
  fail(error);
  const [row] = await withNames(client, (data ?? []) as AuditRecord[]);
  return row ?? null;
}
