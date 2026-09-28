import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedUserId } from "@data/auth/session";
import type { DailyEntry, NewDailyEntry } from "@domain/operations/types";
import {
  mapBus,
  mapDailyEntry,
  type BusRow,
  type DailyEntryRow,
} from "./mappers";
import type { OperationsRepository } from "./repository";

function throwIfError(error: { message: string } | null) {
  if (error) {
    throw new Error(error.message);
  }
}

export class SupabaseOperationsRepository implements OperationsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listBuses() {
    const { data, error } = await this.client
      .from("buses")
      .select("id, registration_number, route_label")
      .order("registration_number", { ascending: true });

    throwIfError(error);
    return ((data ?? []) as BusRow[]).map(mapBus);
  }

  async listEntriesByDate(date: string) {
    const { data, error } = await this.client
      .from("daily_entries")
      .select(
        "id, bus_id, entry_date, kind, category, amount_inr, note, created_at",
      )
      .eq("entry_date", date)
      .order("created_at", { ascending: false });

    throwIfError(error);
    return ((data ?? []) as DailyEntryRow[]).map(mapDailyEntry);
  }

  async addEntry(input: NewDailyEntry): Promise<DailyEntry> {
    const amountInr = Math.round(input.amountInr);
    if (!Number.isFinite(amountInr) || amountInr <= 0) {
      throw new Error("Amount must be a whole rupee greater than 0.");
    }

    const createdBy = await getAuthenticatedUserId(this.client);

    const { data, error } = await this.client
      .from("daily_entries")
      .insert({
        bus_id: input.busId,
        entry_date: input.date,
        kind: input.kind,
        category: input.category,
        amount_inr: amountInr,
        note: input.note.trim(),
        created_by: createdBy,
      })
      .select(
        "id, bus_id, entry_date, kind, category, amount_inr, note, created_at",
      )
      .single();

    throwIfError(error);
    if (!data) {
      throw new Error("Save did not return an entry.");
    }
    return mapDailyEntry(data as DailyEntryRow);
  }

  async removeEntry(id: string) {
    const { error } = await this.client.from("daily_entries").delete().eq("id", id);
    throwIfError(error);
  }
}

export function createSupabaseOperationsRepository(
  client: SupabaseClient,
): OperationsRepository {
  return new SupabaseOperationsRepository(client);
}
