import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_TOUR_SETTINGS,
  type PayMode,
  type TourBooking,
  type TourPayment,
  type TourSettings,
  type TourStatus,
} from "@domain/tours/types";

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

type BookingRow = {
  id: string;
  quote_no: number;
  status: string;
  customer_name: string;
  customer_phone: string;
  pickup: string;
  drop_place: string;
  seats_needed: number | null;
  start_date: string;
  end_date: string;
  start_at: string | null;
  end_at: string | null;
  bus_id: string | null;
  hire_amount_inr: number;
  advance_required_inr: number;
  inclusions: string;
  quote_valid_until: string | null;
  quote_sent_at: string | null;
  trip_id: string | null;
  note: string;
  cancelled_reason: string;
  created_at: string;
};

const STATUSES: TourStatus[] = ["enquiry", "quoted", "confirmed", "completed", "cancelled"];

function mapBooking(row: BookingRow): TourBooking {
  return {
    id: row.id,
    quoteNo: row.quote_no,
    status: (STATUSES as string[]).includes(row.status) ? (row.status as TourStatus) : "enquiry",
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    pickup: row.pickup,
    dropPlace: row.drop_place,
    seatsNeeded: row.seats_needed,
    startDate: row.start_date,
    endDate: row.end_date,
    startAt: row.start_at,
    endAt: row.end_at,
    busId: row.bus_id,
    hireAmountInr: row.hire_amount_inr,
    advanceRequiredInr: row.advance_required_inr,
    inclusions: row.inclusions,
    quoteValidUntil: row.quote_valid_until,
    quoteSentAt: row.quote_sent_at,
    tripId: row.trip_id,
    note: row.note,
    cancelledReason: row.cancelled_reason,
    createdAt: row.created_at,
  };
}

function bookingColumns(input: Partial<TourBooking>) {
  const map: Record<string, unknown> = {
    status: input.status,
    customer_name: input.customerName,
    customer_phone: input.customerPhone,
    pickup: input.pickup,
    drop_place: input.dropPlace,
    seats_needed: input.seatsNeeded,
    start_date: input.startDate,
    end_date: input.endDate,
    start_at: input.startAt,
    end_at: input.endAt,
    bus_id: input.busId,
    hire_amount_inr: input.hireAmountInr,
    advance_required_inr: input.advanceRequiredInr,
    inclusions: input.inclusions,
    quote_valid_until: input.quoteValidUntil,
    quote_sent_at: input.quoteSentAt,
    trip_id: input.tripId,
    note: input.note,
    cancelled_reason: input.cancelledReason,
  };
  // Only the fields that were given: undefined means "leave as it is".
  return Object.fromEntries(Object.entries(map).filter(([, value]) => value !== undefined));
}

export async function listBookings(client: SupabaseClient, organizationId: string): Promise<TourBooking[]> {
  const { data, error } = await client
    .from("tour_bookings")
    .select("*")
    .eq("organization_id", organizationId)
    .order("start_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(2000);
  throwIfError(error);
  return ((data ?? []) as BookingRow[]).map(mapBooking);
}

export async function getBooking(
  client: SupabaseClient,
  organizationId: string,
  bookingId: string,
): Promise<TourBooking | null> {
  const { data, error } = await client
    .from("tour_bookings")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", bookingId)
    .maybeSingle();
  throwIfError(error);
  return data ? mapBooking(data as BookingRow) : null;
}

export async function createBooking(
  client: SupabaseClient,
  organizationId: string,
  input: Partial<TourBooking>,
): Promise<TourBooking> {
  const { data, error } = await client
    .from("tour_bookings")
    .insert({ organization_id: organizationId, ...bookingColumns(input) })
    .select("*")
    .single();
  throwIfError(error);
  return mapBooking(data as BookingRow);
}

export async function updateBooking(
  client: SupabaseClient,
  organizationId: string,
  bookingId: string,
  input: Partial<TourBooking>,
): Promise<TourBooking> {
  const { data, error } = await client
    .from("tour_bookings")
    .update(bookingColumns(input))
    .eq("organization_id", organizationId)
    .eq("id", bookingId)
    .select("*");
  throwIfError(error);
  if (!data?.length) throw new Error("Could not update this booking.");
  return mapBooking(data[0] as BookingRow);
}

export async function deleteBooking(client: SupabaseClient, organizationId: string, bookingId: string) {
  const { error } = await client
    .from("tour_bookings")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", bookingId);
  throwIfError(error);
}

type PaymentRow = {
  id: string;
  booking_id: string;
  received_on: string;
  amount_inr: number;
  mode: string;
  note: string;
};

export async function listTourPayments(client: SupabaseClient, organizationId: string): Promise<TourPayment[]> {
  const { data, error } = await client
    .from("tour_payments")
    .select("id, booking_id, received_on, amount_inr, mode, note")
    .eq("organization_id", organizationId)
    .order("received_on", { ascending: true })
    .limit(5000);
  throwIfError(error);
  return ((data ?? []) as PaymentRow[]).map((row) => ({
    id: row.id,
    bookingId: row.booking_id,
    receivedOn: row.received_on,
    amountInr: row.amount_inr,
    mode: (["cash", "upi", "bank"].includes(row.mode) ? row.mode : "cash") as PayMode,
    note: row.note,
  }));
}

export async function addTourPayment(
  client: SupabaseClient,
  organizationId: string,
  input: Omit<TourPayment, "id">,
) {
  const { error } = await client.from("tour_payments").insert({
    organization_id: organizationId,
    booking_id: input.bookingId,
    received_on: input.receivedOn,
    amount_inr: input.amountInr,
    mode: input.mode,
    note: input.note,
  });
  throwIfError(error);
}

export async function deleteTourPayment(client: SupabaseClient, organizationId: string, paymentId: string) {
  const { error } = await client
    .from("tour_payments")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", paymentId);
  throwIfError(error);
}

/** Quote defaults. Before 0016 is run, or if the read fails, the built-in defaults apply. */
export async function getTourSettings(client: SupabaseClient, organizationId: string): Promise<TourSettings> {
  const { data, error } = await client
    .from("organizations")
    .select("tour_quote_valid_days, tour_advance_percent, tour_turnaround_hours")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data) return DEFAULT_TOUR_SETTINGS;
  const row = data as {
    tour_quote_valid_days: number;
    tour_advance_percent: number;
    tour_turnaround_hours: number;
  };
  return {
    quoteValidDays: row.tour_quote_valid_days ?? DEFAULT_TOUR_SETTINGS.quoteValidDays,
    advancePercent: row.tour_advance_percent ?? DEFAULT_TOUR_SETTINGS.advancePercent,
    turnaroundHours: row.tour_turnaround_hours ?? DEFAULT_TOUR_SETTINGS.turnaroundHours,
  };
}

export async function saveTourSettings(client: SupabaseClient, organizationId: string, input: TourSettings) {
  const { data, error } = await client
    .from("organizations")
    .update({
      tour_quote_valid_days: input.quoteValidDays,
      tour_advance_percent: input.advancePercent,
      tour_turnaround_hours: input.turnaroundHours,
    })
    .eq("id", organizationId)
    .select("id");
  throwIfError(error);
  if (!data?.length) throw new Error("Could not save the tour settings.");
}
