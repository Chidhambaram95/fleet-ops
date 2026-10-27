import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  NewTyre,
  ScrapReceivedVia,
  Tyre,
  TyreEvent,
  TyreClaim,
  TyreClaimStatus,
  TyreEventKind,
  TyreLifeSettings,
  TyreMove,
  TyreScrapSale,
  TyreStatus,
} from "@domain/tyres/types";

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
    scrapPileOn: typeof row.scrap_pile_on === "string" ? row.scrap_pile_on : null,
    warrantyClaimOn: typeof row.warranty_claim_on === "string" ? row.warranty_claim_on : null,
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
    scrapSaleId: typeof row.scrap_sale_id === "string" ? row.scrap_sale_id : null,
    warrantyClaimId: typeof row.warranty_claim_id === "string" ? row.warranty_claim_id : null,
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
 * The latest odometer known for a bus: its newest trip-sheet closing km, tyre
 * reading or crew odometer reading, whichever is higher. Null when there is none.
 */
export async function latestOdometer(
  client: SupabaseClient,
  organizationId: string,
  busId: string,
): Promise<number | null> {
  const [trips, tyres, readings] = await Promise.all([
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
    client
      .from("odometer_readings")
      .select("odometer_km")
      .eq("organization_id", organizationId)
      .eq("bus_id", busId)
      .order("odometer_km", { ascending: false })
      .limit(1),
  ]);
  throwIfError(trips.error);
  throwIfError(tyres.error);
  throwIfError(readings.error);
  const known = [
    num((trips.data?.[0] as Row | undefined)?.end_km),
    num((tyres.data?.[0] as Row | undefined)?.odometer_km),
    num((readings.data?.[0] as Row | undefined)?.odometer_km),
  ].filter((value): value is number => value != null);
  return known.length ? Math.max(...known) : null;
}

/** Latest odometer for every bus at once, for the km-so-far figures. */
export async function latestOdometers(client: SupabaseClient, organizationId: string): Promise<Map<string, number>> {
  const [trips, tyres, readings] = await Promise.all([
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
    client
      .from("odometer_readings")
      .select("bus_id, odometer_km")
      .eq("organization_id", organizationId)
      .order("odometer_km", { ascending: false })
      .limit(5000),
  ]);
  throwIfError(trips.error);
  throwIfError(tyres.error);
  throwIfError(readings.error);
  const latest = new Map<string, number>();
  const note = (busId: unknown, km: unknown) => {
    if (typeof busId !== "string" || km == null) return;
    latest.set(busId, Math.max(latest.get(busId) ?? 0, Number(km)));
  };
  for (const row of (trips.data ?? []) as Row[]) note(row.bus_id, row.end_km);
  for (const row of (tyres.data ?? []) as Row[]) note(row.bus_id, row.odometer_km);
  for (const row of (readings.data ?? []) as Row[]) note(row.bus_id, row.odometer_km);
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

/** Put an off-bus tyre on the scrap pile, or take it back. */
export async function setScrapPile(client: SupabaseClient, tyreId: string, onPile: boolean) {
  const { error } = await client.rpc("tyre_scrap_pile", { p_tyre: tyreId, p_on: onPile });
  throwIfError(error);
}

/** Sell tyres together as scrap. Each is scrapped; the money is one company income entry. */
export async function sellScrap(
  client: SupabaseClient,
  input: { tyreIds: string[]; date: string; buyer: string; amountInr: number; receivedVia: ScrapReceivedVia; note: string },
): Promise<string> {
  const { data, error } = await client.rpc("tyre_sell_scrap", {
    p_tyres: input.tyreIds,
    p_date: input.date,
    p_buyer: input.buyer,
    p_amount: input.amountInr,
    p_via: input.receivedVia,
    p_note: input.note,
  });
  throwIfError(error);
  return String(data);
}

/** Admins only: the tyres go back on the pile and the sale is removed. */
export async function undoScrapSale(client: SupabaseClient, saleId: string) {
  const { error } = await client.rpc("tyre_undo_scrap_sale", { p_sale: saleId });
  throwIfError(error);
}

/** Scrap sales, newest first, optionally between two dates (inclusive). */
export async function listScrapSales(
  client: SupabaseClient,
  organizationId: string,
  range?: { from: string; to: string },
): Promise<TyreScrapSale[]> {
  let query = client.from("tyre_scrap_sales").select("*").eq("organization_id", organizationId);
  if (range) query = query.gte("sold_on", range.from).lte("sold_on", range.to);
  const { data, error } = await query.order("sold_on", { ascending: false }).limit(2000);
  throwIfError(error);
  return ((data ?? []) as Row[]).map((row) => ({
    id: str(row.id),
    soldOn: str(row.sold_on),
    buyer: str(row.buyer),
    amountInr: Number(row.amount_inr ?? 0),
    receivedVia: row.received_via === "account" ? "account" : "cash",
    tyreCount: Number(row.tyre_count ?? 0),
    note: str(row.note),
  }));
}

function mapClaim(row: Row): TyreClaim {
  return {
    id: str(row.id),
    tyreId: str(row.tyre_id),
    raisedOn: str(row.raised_on),
    dealer: str(row.dealer),
    reason: str(row.reason),
    note: str(row.note),
    kmAtClaim: Number(row.km_at_claim ?? 0),
    lifeKmAtClaim: Number(row.life_km_at_claim ?? 0),
    status: str(row.status) as TyreClaimStatus,
    closedOn: typeof row.closed_on === "string" ? row.closed_on : null,
    outcomeNote: str(row.outcome_note),
    creditInr: num(row.credit_inr),
    creditBusId: typeof row.credit_bus_id === "string" ? row.credit_bus_id : null,
    creditBusLabel: str(row.credit_bus_label),
    replacementTyreId: typeof row.replacement_tyre_id === "string" ? row.replacement_tyre_id : null,
    topUpInr: num(row.top_up_inr),
  };
}

/** Warranty claims, newest first: for one tyre, or every claim of the company. */
export async function listClaims(
  client: SupabaseClient,
  organizationId: string,
  tyreId?: string,
): Promise<TyreClaim[]> {
  let query = client.from("tyre_warranty_claims").select("*").eq("organization_id", organizationId);
  if (tyreId) query = query.eq("tyre_id", tyreId);
  const { data, error } = await query.order("raised_on", { ascending: false }).limit(2000);
  throwIfError(error);
  return ((data ?? []) as Row[]).map(mapClaim);
}

/** Credits settled between two dates (inclusive), for reports. */
export async function listWarrantyCredits(
  client: SupabaseClient,
  organizationId: string,
  range: { from: string; to: string },
): Promise<TyreClaim[]> {
  const { data, error } = await client
    .from("tyre_warranty_claims")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("status", "credited")
    .gte("closed_on", range.from)
    .lte("closed_on", range.to)
    .limit(2000);
  throwIfError(error);
  return ((data ?? []) as Row[]).map(mapClaim);
}

export async function raiseClaim(
  client: SupabaseClient,
  tyreId: string,
  input: { date: string; dealer: string; reason: string; note: string },
): Promise<string> {
  const { data, error } = await client.rpc("tyre_raise_claim", {
    p_tyre: tyreId,
    p_date: input.date,
    p_dealer: input.dealer,
    p_reason: input.reason,
    p_note: input.note,
  });
  throwIfError(error);
  return String(data);
}

export async function cancelClaim(client: SupabaseClient, claimId: string) {
  const { error } = await client.rpc("tyre_cancel_claim", { p_claim: claimId });
  throwIfError(error);
}

/** The dealer's answer. Returns the new tyre's id when the tyre was replaced. */
export async function closeClaim(
  client: SupabaseClient,
  claimId: string,
  input: {
    outcome: "replaced" | "credited" | "rejected";
    date: string;
    amountInr: number | null;
    newTyreNumber: string;
    after: "stock" | "pile";
    note: string;
  },
): Promise<string | null> {
  const { data, error } = await client.rpc("tyre_close_claim", {
    p_claim: claimId,
    p_outcome: input.outcome,
    p_date: input.date,
    p_amount: input.amountInr,
    p_new_number: input.newTyreNumber,
    p_after: input.after,
    p_note: input.note,
  });
  throwIfError(error);
  return typeof data === "string" ? data : null;
}
