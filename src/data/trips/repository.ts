import type { SupabaseClient } from "@supabase/supabase-js";
import { TRIP_EXPENSE_IDS } from "@domain/trips/catalog";
import type {
  DieselFill,
  Trip,
  TripExpense,
  TripExpenseCategory,
  TripStatus,
  TripSummary,
} from "@domain/trips/types";

const PHOTO_BUCKET = "trip-sheets";

const TRIP_COLUMNS =
  "id, bus_id, sheet_no, route, started_at, ended_at, halt_note, driver1, driver2, cleaner, start_km, end_km, advance_inr, written_total_inr, photo_path, status, approved_at, settled_on";

type TripRow = {
  id: string;
  bus_id: string;
  sheet_no: string;
  route: string;
  started_at: string | null;
  ended_at: string | null;
  halt_note: string;
  driver1: string;
  driver2: string;
  cleaner: string;
  start_km: number | null;
  end_km: number | null;
  advance_inr: number;
  written_total_inr: number | null;
  photo_path: string;
  status: string;
  approved_at: string | null;
  settled_on?: string | null;
};

type ItemRow = {
  trip_id: string;
  kind: string;
  category: string;
  amount_inr: number;
  litres: number | string | null;
  paid_by: string;
  pump: string;
  note: string;
};

function throwIfError(error: { message: string } | null) {
  if (error) {
    throw new Error(error.message);
  }
}

function mapTrip(row: TripRow, items: ItemRow[]): Trip {
  const diesel: DieselFill[] = items
    .filter((item) => item.kind === "diesel")
    .map((item) => ({
      litres: item.litres == null ? null : Number(item.litres),
      amountInr: item.amount_inr,
      paidBy: item.paid_by === "credit" ? "credit" : "cash",
      pump: item.pump,
    }));
  const expenses: TripExpense[] = items
    .filter((item) => item.kind === "expense")
    .map((item) => ({
      category: (TRIP_EXPENSE_IDS as string[]).includes(item.category)
        ? (item.category as TripExpenseCategory)
        : "other",
      amountInr: item.amount_inr,
      note: item.note,
    }));
  return {
    id: row.id,
    busId: row.bus_id,
    sheetNo: row.sheet_no,
    route: row.route,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    haltNote: row.halt_note,
    driver1: row.driver1,
    driver2: row.driver2,
    cleaner: row.cleaner,
    startKm: row.start_km,
    endKm: row.end_km,
    advanceInr: row.advance_inr,
    writtenTotalInr: row.written_total_inr,
    photoPath: row.photo_path,
    status: (row.status === "approved" ? "approved" : "draft") as TripStatus,
    approvedAt: row.approved_at,
    settledOn: row.settled_on ?? null,
    diesel,
    expenses,
  };
}

const ITEM_COLUMNS = "trip_id, kind, category, amount_inr, litres, paid_by, pump, note";

/**
 * Trips with all their lines. A date range matches the day a trip started
 * (IST); approvedOnly keeps reports to approved trips.
 */
export async function listTripsWithLines(
  client: SupabaseClient,
  organizationId: string,
  options: { from?: string; to?: string; approvedOnly?: boolean; limit?: number } = {},
): Promise<Trip[]> {
  let query = client.from("trips").select(TRIP_COLUMNS).eq("organization_id", organizationId);
  if (options.from) query = query.gte("started_at", `${options.from}T00:00:00+05:30`);
  if (options.to) query = query.lte("started_at", `${options.to}T23:59:59+05:30`);
  if (options.approvedOnly) query = query.eq("status", "approved");
  const { data, error } = await query
    .order("started_at", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 1000);
  throwIfError(error);
  const rows = (data ?? []) as TripRow[];
  if (rows.length === 0) {
    return [];
  }
  const items: ItemRow[] = [];
  // Keep each request's id list short enough for a URL.
  for (let start = 0; start < rows.length; start += 100) {
    const { data: itemData, error: itemError } = await client
      .from("trip_items")
      .select(ITEM_COLUMNS)
      .in(
        "trip_id",
        rows.slice(start, start + 100).map((row) => row.id),
      )
      .order("position", { ascending: true });
    throwIfError(itemError);
    items.push(...((itemData ?? []) as ItemRow[]));
  }
  return rows.map((row) =>
    mapTrip(
      row,
      items.filter((item) => item.trip_id === row.id),
    ),
  );
}

export async function listTrips(
  client: SupabaseClient,
  organizationId: string,
): Promise<TripSummary[]> {
  const trips = await listTripsWithLines(client, organizationId, { limit: 200 });
  return trips.map((trip) => {
    const { diesel, expenses, ...rest } = trip;
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
    return {
      ...rest,
      dieselLitres: sum(diesel.map((fill) => fill.litres ?? 0)),
      dieselInr: sum(diesel.map((fill) => fill.amountInr)),
      cashSpentInr:
        sum(expenses.map((item) => item.amountInr)) +
        sum(diesel.filter((fill) => fill.paidBy === "cash").map((fill) => fill.amountInr)),
    };
  });
}

export async function getTrip(
  client: SupabaseClient,
  organizationId: string,
  tripId: string,
): Promise<Trip | null> {
  const { data, error } = await client
    .from("trips")
    .select(TRIP_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", tripId)
    .maybeSingle();
  throwIfError(error);
  if (!data) {
    return null;
  }
  const { data: items, error: itemError } = await client
    .from("trip_items")
    .select(ITEM_COLUMNS)
    .eq("trip_id", tripId)
    .order("position", { ascending: true });
  throwIfError(itemError);
  return mapTrip(data as TripRow, (items ?? []) as ItemRow[]);
}

export type TripInput = Omit<Trip, "id" | "status" | "approvedAt" | "settledOn"> & {
  id?: string;
};

/** Saves the trip and all its lines together; optionally approves it. */
export async function saveTrip(
  client: SupabaseClient,
  organizationId: string,
  trip: TripInput,
  approve: boolean,
): Promise<string> {
  const items = [
    ...trip.diesel.map((fill) => ({
      kind: "diesel",
      category: "diesel",
      amount_inr: fill.amountInr,
      litres: fill.litres ?? "",
      paid_by: fill.paidBy,
      pump: fill.pump,
      note: "",
    })),
    ...trip.expenses.map((item) => ({
      kind: "expense",
      category: item.category,
      amount_inr: item.amountInr,
      litres: "",
      paid_by: "cash",
      pump: "",
      note: item.note,
    })),
  ];
  const { data, error } = await client.rpc("save_trip", {
    p_trip: {
      id: trip.id ?? "",
      organization_id: organizationId,
      bus_id: trip.busId,
      sheet_no: trip.sheetNo,
      route: trip.route,
      started_at: trip.startedAt ?? "",
      ended_at: trip.endedAt ?? "",
      halt_note: trip.haltNote,
      driver1: trip.driver1,
      driver2: trip.driver2,
      cleaner: trip.cleaner,
      start_km: trip.startKm ?? "",
      end_km: trip.endKm ?? "",
      advance_inr: trip.advanceInr,
      written_total_inr: trip.writtenTotalInr ?? "",
      photo_path: trip.photoPath,
    },
    p_items: items,
    p_approve: approve,
  });
  throwIfError(error);
  return String(data);
}

export async function deleteTrip(
  client: SupabaseClient,
  organizationId: string,
  tripId: string,
) {
  const { error } = await client
    .from("trips")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", tripId);
  throwIfError(error);
}

/** Uploads the trip sheet photo and returns its storage path. */
export async function uploadTripPhoto(
  client: SupabaseClient,
  organizationId: string,
  photo: Blob,
): Promise<string> {
  const path = `${organizationId}/${crypto.randomUUID()}.jpg`;
  const { error } = await client.storage
    .from(PHOTO_BUCKET)
    .upload(path, photo, { contentType: "image/jpeg", upsert: false });
  throwIfError(error);
  return path;
}

export async function tripPhotoUrl(client: SupabaseClient, path: string) {
  const { data, error } = await client.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, 60 * 60);
  throwIfError(error);
  return data?.signedUrl ?? "";
}

/** A bus's usual km per litre from its approved trips, or null with too little history. */
export async function usualMileage(
  client: SupabaseClient,
  organizationId: string,
  busId: string,
  excludeTripId?: string,
): Promise<number | null> {
  const { data, error } = await client
    .from("trips")
    .select("id, start_km, end_km")
    .eq("organization_id", organizationId)
    .eq("bus_id", busId)
    .eq("status", "approved")
    .not("start_km", "is", null)
    .not("end_km", "is", null)
    .order("started_at", { ascending: false })
    .limit(10);
  throwIfError(error);
  const trips = ((data ?? []) as { id: string; start_km: number; end_km: number }[]).filter(
    (trip) => trip.id !== excludeTripId,
  );
  if (trips.length < 2) {
    return null;
  }
  const { data: fills, error: fillError } = await client
    .from("trip_items")
    .select("trip_id, litres")
    .eq("kind", "diesel")
    .in(
      "trip_id",
      trips.map((trip) => trip.id),
    );
  throwIfError(fillError);
  const litres = ((fills ?? []) as { litres: number | string | null }[]).reduce(
    (total, fill) => total + Number(fill.litres ?? 0),
    0,
  );
  const km = trips.reduce((total, trip) => total + (trip.end_km - trip.start_km), 0);
  return litres > 0 && km > 0 ? km / litres : null;
}
