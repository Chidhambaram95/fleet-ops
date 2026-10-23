import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewTyre, Tyre, TyreEvent, TyreEventKind, TyreLifeSettings, TyreMove, TyreStatus } from "@domain/tyres/types";

/** Used until migration 0019 is run, or when the company has not changed them. */
export const DEFAULT_TYRE_LIFE: TyreLifeSettings = { newLifeKm: 80000, retreadLifeKm: 40000 };

const PHOTO_BUCKET = "trip-sheets";

function throwIfError(error: { message: string } | null) {
  if (error) {
    throw new Error(error.message);
  }
}

type Row = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (value == null ? null : Number(value));

function mapTyre(row: Row): Tyre {
  return {
    id: str(row.id),
    tyreNumber: str(row.tyre_number),
    brand: str(row.brand),
    size: str(row.size),
    boughtAs: row.bought_as === "retreaded" ? "retreaded" : "new",
    purchaseDate: str(row.purchase_date),
    purchasePriceInr: num(row.purchase_price_inr),
    vendor: str(row.vendor),
    billPhotoPath: str(row.bill_photo_path),
    warrantyMonths: num(row.warranty_months),
    warrantyKm: num(row.warranty_km),
    warrantyNote: str(row.warranty_note),
    note: str(row.note),
    status: str(row.status) as TyreStatus,
    currentBusId: typeof row.current_bus_id === "string" ? row.current_bus_id : null,
    currentPosition: typeof row.current_position === "string" ? row.current_position : null,
    fittedOdometerKm: num(row.fitted_odometer_km),
    retreadCount: Number(row.retread_count ?? 0),
    totalKm: Number(row.total_km ?? 0),
    unchargedInr: Number(row.uncharged_inr ?? 0),
    lifeKm: Number(row.life_km ?? row.total_km ?? 0),
    lifeLimitKm: row.life_limit_km === undefined ? num(row.warranty_km) : num(row.life_limit_km),
  };
}

function mapEvent(row: Row): TyreEvent {
  return {
    id: str(row.id),
    seq: Number(row.seq ?? 0),
    tyreId: str(row.tyre_id),
    kind: str(row.kind) as TyreEventKind,
    eventDate: str(row.event_date),
    busId: typeof row.bus_id === "string" ? row.bus_id : null,
    busLabel: str(row.bus_label),
    position: typeof row.position === "string" ? row.position : null,
    fromPosition: typeof row.from_position === "string" ? row.from_position : null,
    odometerKm: num(row.odometer_km),
    kmRun: num(row.km_run),
    costInr: num(row.cost_inr),
    chargeInr: Number(row.charge_inr ?? 0),
    vendor: str(row.vendor),
    reason: str(row.reason),
    note: str(row.note),
    warrantyKm: num(row.warranty_km),
    warrantyMonths: num(row.warranty_months),
  };
}

export async function listTyres(client: SupabaseClient, organizationId: string): Promise<Tyre[]> {
  const { data, error } = await client
    .from("tyres")
    .select("*")
    .eq("organization_id", organizationId)
    .order("tyre_number", { ascending: true })
    .limit(5000);
  throwIfError(error);
  return ((data ?? []) as Row[]).map(mapTyre);
}

export async function getTyre(client: SupabaseClient, organizationId: string, id: string): Promise<Tyre | null> {
  const { data, error } = await client
    .from("tyres")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  throwIfError(error);
  return data ? mapTyre(data as Row) : null;
}

/** One tyre's history, oldest first. */
export async function listTyreEvents(client: SupabaseClient, organizationId: string, tyreId: string): Promise<TyreEvent[]> {
  const { data, error } = await client
    .from("tyre_events")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("tyre_id", tyreId)
    .order("seq", { ascending: true });
  throwIfError(error);
  return ((data ?? []) as Row[]).map(mapEvent);
}

/** Every tyre event between two dates (inclusive), for reports and the cost tiles. */
export async function listTyreEventsBetween(
  client: SupabaseClient,
  organizationId: string,
  range: { from: string; to: string },
): Promise<TyreEvent[]> {
  const { data, error } = await client
    .from("tyre_events")
    .select("*")
    .eq("organization_id", organizationId)
    .gte("event_date", range.from)
    .lte("event_date", range.to)
    .order("seq", { ascending: true })
    .limit(10000);
  throwIfError(error);
  return ((data ?? []) as Row[]).map(mapEvent);
}

function tyreRow(input: NewTyre) {
  return {
    tyre_number: input.tyreNumber.trim(),
    brand: input.brand.trim(),
    size: input.size.trim(),
    bought_as: input.boughtAs,
    purchase_date: input.purchaseDate,
    purchase_price_inr: input.purchasePriceInr,
    vendor: input.vendor.trim(),
    bill_photo_path: input.billPhotoPath,
    warranty_months: input.warrantyMonths,
    warranty_km: input.warrantyKm,
    warranty_note: input.warrantyNote.trim(),
    note: input.note.trim(),
  };
}

/** Adds a tyre and returns its id. */
export async function addTyre(client: SupabaseClient, organizationId: string, input: NewTyre): Promise<string> {
  const { data, error } = await client
    .from("tyres")
    .insert({ organization_id: organizationId, ...tyreRow(input) })
    .select("id")
    .single();
  throwIfError(error);
  return str((data as Row).id);
}

export async function updateTyre(client: SupabaseClient, organizationId: string, id: string, input: NewTyre) {
  const { error } = await client
    .from("tyres")
    .update(tyreRow(input))
    .eq("organization_id", organizationId)
    .eq("id", id);
  throwIfError(error);
}

export async function deleteTyre(client: SupabaseClient, organizationId: string, id: string) {
  const { error } = await client.from("tyres").delete().eq("organization_id", organizationId).eq("id", id);
  throwIfError(error);
}

/** Fit, rotate, remove, retread, repair or scrap. The database checks the move. */
export async function moveTyre(client: SupabaseClient, tyreId: string, move: TyreMove) {
  const { data, error } = await client.rpc("tyre_move", {
    p_tyre: tyreId,
    p_kind: move.kind,
    p_date: move.date,
    p_bus: move.busId ?? null,
    p_position: move.position ?? null,
    p_odometer: move.odometerKm ?? null,
    p_cost: move.costInr ?? null,
    p_vendor: move.vendor ?? "",
    p_reason: move.reason ?? "",
    p_note: move.note ?? "",
  });
  throwIfError(error);
  if (move.kind === "retread_received" && (move.warrantyKm || move.warrantyMonths)) {
    const result = await client.rpc("tyre_set_retread_warranty", {
      p_event: data,
      p_km: move.warrantyKm ?? null,
      p_months: move.warrantyMonths ?? null,
    });
    throwIfError(result.error);
  }
}

/** Expected km per life. Before 0019 is run, or if the read fails, the defaults apply. */
export async function getTyreLifeSettings(client: SupabaseClient, organizationId: string): Promise<TyreLifeSettings> {
  const { data, error } = await client
    .from("organizations")
    .select("tyre_new_life_km, tyre_retread_life_km")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data) return DEFAULT_TYRE_LIFE;
  const row = data as Row;
  return {
    newLifeKm: Number(row.tyre_new_life_km ?? DEFAULT_TYRE_LIFE.newLifeKm),
    retreadLifeKm: Number(row.tyre_retread_life_km ?? DEFAULT_TYRE_LIFE.retreadLifeKm),
  };
}

export async function saveTyreLifeSettings(client: SupabaseClient, organizationId: string, input: TyreLifeSettings) {
  const { data, error } = await client
    .from("organizations")
    .update({ tyre_new_life_km: input.newLifeKm, tyre_retread_life_km: input.retreadLifeKm })
    .eq("id", organizationId)
    .select("id");
  throwIfError(error);
  if (!data?.length) throw new Error("Could not save the tyre settings.");
}

export async function undoLastTyreMove(client: SupabaseClient, tyreId: string) {
  const { error } = await client.rpc("tyre_undo_last", { p_tyre: tyreId });
  throwIfError(error);
}

/**
 * The latest odometer known for a bus: its newest trip-sheet closing km or
 * tyre reading, whichever is higher. Null when there is none.
 */
export async function latestOdometer(
  client: SupabaseClient,
  organizationId: string,
  busId: string,
): Promise<number | null> {
  const [trips, tyres] = await Promise.all([
    client
      .from("trips")
      .select("end_km")
      .eq("organization_id", organizationId)
      .eq("bus_id", busId)
      .not("end_km", "is", null)
      .order("end_km", { ascending: false })
      .limit(1),
    client
      .from("tyre_events")
      .select("odometer_km")
      .eq("organization_id", organizationId)
      .eq("bus_id", busId)
      .not("odometer_km", "is", null)
      .order("odometer_km", { ascending: false })
      .limit(1),
  ]);
  throwIfError(trips.error);
  throwIfError(tyres.error);
  const readings = [
    num((trips.data?.[0] as Row | undefined)?.end_km),
    num((tyres.data?.[0] as Row | undefined)?.odometer_km),
  ].filter((value): value is number => value != null);
  return readings.length ? Math.max(...readings) : null;
}

/** Latest odometer for every bus at once, for the km-so-far figures. */
export async function latestOdometers(client: SupabaseClient, organizationId: string): Promise<Map<string, number>> {
  const [trips, tyres] = await Promise.all([
    client
      .from("trips")
      .select("bus_id, end_km")
      .eq("organization_id", organizationId)
      .not("end_km", "is", null)
      .order("end_km", { ascending: false })
      .limit(5000),
    client
      .from("tyre_events")
      .select("bus_id, odometer_km")
      .eq("organization_id", organizationId)
      .not("bus_id", "is", null)
      .not("odometer_km", "is", null)
      .order("odometer_km", { ascending: false })
      .limit(5000),
  ]);
  throwIfError(trips.error);
  throwIfError(tyres.error);
  const latest = new Map<string, number>();
  const note = (busId: unknown, km: unknown) => {
    if (typeof busId !== "string" || km == null) return;
    latest.set(busId, Math.max(latest.get(busId) ?? 0, Number(km)));
  };
  for (const row of (trips.data ?? []) as Row[]) note(row.bus_id, row.end_km);
  for (const row of (tyres.data ?? []) as Row[]) note(row.bus_id, row.odometer_km);
  return latest;
}

export async function uploadTyreBill(client: SupabaseClient, organizationId: string, photo: Blob): Promise<string> {
  const path = `${organizationId}/tyres/${crypto.randomUUID()}.jpg`;
  const { error } = await client.storage
    .from(PHOTO_BUCKET)
    .upload(path, photo, { contentType: "image/jpeg", upsert: false });
  throwIfError(error);
  return path;
}

export async function tyreBillUrl(client: SupabaseClient, path: string) {
  const { data, error } = await client.storage.from(PHOTO_BUCKET).createSignedUrl(path, 60 * 60);
  throwIfError(error);
  return data?.signedUrl ?? "";
}
