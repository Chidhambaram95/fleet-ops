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

  async listBuses(organizationId: string) {
    const { data, error } = await this.client
      .from("buses")
      .select("id, registration_number, route_label")
      .eq("organization_id", organizationId)
      .order("registration_number", { ascending: true });

    throwIfError(error);
    return ((data ?? []) as BusRow[]).map(mapBus);
  }

  async listEntriesByDate(organizationId: string, date: string) {
    const { data, error } = await this.client
      .from("daily_entries")
      .select(
        "id, bus_id, entry_date, kind, category, amount_inr, note, created_at",
      )
      .eq("organization_id", organizationId)
      .eq("entry_date", date)
      .order("created_at", { ascending: false });

    throwIfError(error);
    return ((data ?? []) as DailyEntryRow[]).map(mapDailyEntry);
  }

  async addEntry(organizationId: string, input: NewDailyEntry): Promise<DailyEntry> {
    const amountInr = Math.round(input.amountInr);
    if (!Number.isFinite(amountInr) || amountInr <= 0) {
      throw new Error("Amount must be a whole rupee greater than 0.");
    }

    const { data: bus, error: busError } = await this.client
      .from("buses")
      .select("id")
      .eq("id", input.busId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    throwIfError(busError);
    if (!bus) {
      throw new Error("That bus is not in this organization.");
    }

    const createdBy = await getAuthenticatedUserId(this.client);

    const { data, error } = await this.client
      .from("daily_entries")
      .insert({
        organization_id: organizationId,
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

  async removeEntry(organizationId: string, id: string) {
    const { error } = await this.client
      .from("daily_entries")
      .delete()
      .eq("organization_id", organizationId)
      .eq("id", id);
    throwIfError(error);
  }
}

export function createSupabaseOperationsRepository(
  client: SupabaseClient,
): OperationsRepository {
  return new SupabaseOperationsRepository(client);
}
