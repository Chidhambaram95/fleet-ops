import type { SupabaseClient } from "@supabase/supabase-js";
import { throwIfError } from "@data/supabase/errors";

/** A database value as text: the string itself, or an empty string for null or anything else. */
export const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** A database value as a number; 0 when missing. */
export const num = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0));

export type DateRange = { from?: string; to?: string };

/** Rows of one company, newest first, optionally between two dates (inclusive). */
export async function listRows<Row>(
  client: SupabaseClient,
  table: string,
  organizationId: string,
  dateColumn: string,
  range: DateRange = {},
  limit = 500,
): Promise<Row[]> {
  let query = client.from(table).select("*").eq("organization_id", organizationId);
  if (range.from) query = query.gte(dateColumn, range.from);
  if (range.to) query = query.lte(dateColumn, range.to);
  const { data, error } = await query.order(dateColumn, { ascending: false }).limit(limit);
  throwIfError(error);
  return (data ?? []) as Row[];
}

/** Inserts one row for the company. */
export async function insertRow(
  client: SupabaseClient,
  table: string,
  organizationId: string,
  values: Record<string, unknown>,
) {
  const { error } = await client.from(table).insert({ organization_id: organizationId, ...values });
  throwIfError(error);
}
