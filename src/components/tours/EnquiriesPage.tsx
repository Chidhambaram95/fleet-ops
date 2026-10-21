"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { addTourPayment, createBooking, updateBooking } from "@data/tours/repository";
import { formatInr, todayInIst } from "@domain/operations/totals";
import {
  clashFor,
  isQuoteExpired,
  quoteValidUntil,
  suggestedAdvance,
  tourDays,
} from "@domain/tours/calc";
import { longDay, quoteNumber, tripLine, whenLine } from "@domain/tours/messages";
import { PAY_MODES, type PayMode, type TourBooking } from "@domain/tours/types";
import { useOrg } from "@/components/billing/OrgContext";
import {
  ErrorText,
  FIELD,
  LABEL,
  PageHeader,
  PRIMARY,
  SmallButton,
  Tabs,
  messageFromUnknown,
  wholeNumber,
} from "@/components/ui/kit";
import { Chip, QuoteShare, Sheet, StatusPill, timeOf, toIso, useTourData, type TourData } from "./shared";

type Tab = "open" | "lost";

type EnquiryForm = {
  customerName: string;
  customerPhone: string;
  pickup: string;
  dropPlace: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  seats: string;
  note: string;
};

function emptyEnquiry(today: string): EnquiryForm {
  return {
    customerName: "",
    customerPhone: "",
    pickup: "",
    dropPlace: "",
    startDate: today,
    startTime: "",
    endDate: today,
    endTime: "",
    seats: "",
    note: "",
  };
}

function formFrom(booking: TourBooking): EnquiryForm {
  return {
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    pickup: booking.pickup,
    dropPlace: booking.dropPlace,
    startDate: booking.startDate,
    startTime: timeOf(booking.startAt),
    endDate: booking.endDate,
    endTime: timeOf(booking.endAt),
    seats: booking.seatsNeeded ? String(booking.seatsNeeded) : "",
    note: booking.note,
  };
}

/** Why an enquiry can't be saved, or an empty string. */
function enquiryProblem(form: EnquiryForm) {
  if (!form.customerName.trim()) return "Enter the customer's name.";
  if (!form.startDate || !form.endDate) return "Pick the first and last day of the tour.";
  if (form.endDate < form.startDate) return "The tour ends before it starts.";
  if ((form.startTime && !form.endTime) || (!form.startTime && form.endTime)) {
    return "Give both the leaving time and the return time, or neither.";
  }
  if (form.startTime && form.endTime && `${form.endDate}T${form.endTime}` <= `${form.startDate}T${form.startTime}`) {
    return "The return time must be after the leaving time.";
  }
  if (form.customerPhone.trim() && form.customerPhone.replace(/\D/g, "").length < 10) {
    return "Enter the customer's phone number with 10 digits.";
  }
  if (form.seats.trim() && !wholeNumber(form.seats)) return "Enter how many people as a number.";
  return "";
}

export function EnquiriesPage({ organizationId }: { organizationId: string }) {
  const org = useOrg();
  const today = todayInIst();
  const { supabase, data, loading, error, reload } = useTourData(organizationId);
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>("open");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<EnquiryForm>(() => emptyEnquiry(today));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [quoting, setQuoting] = useState<TourBooking | null>(null);
  const [confirming, setConfirming] = useState<TourBooking | null>(null);
  const [sharing, setSharing] = useState<TourBooking | null>(null);
  const [losing, setLosing] = useState<TourBooking | null>(null);

  // The + tab and the home screen open this page ready for a new enquiry.
  const wantsNew = params.get("new") === "1";
  useEffect(() => {
    if (wantsNew && !org.viewOnly) {
      setEditing(null);
      setForm(emptyEnquiry(todayInIst()));
      setFormOpen(true);
    }
  }, [wantsNew, org.viewOnly]);

  const open = data.bookings.filter((item) => item.status === "enquiry" || item.status === "quoted");
  const lost = data.bookings.filter((item) => item.status === "cancelled");
  const shown = (tab === "open" ? open : lost).slice().sort((left, right) => left.startDate.localeCompare(right.startDate));

  function startNew() {
    setEditing(null);
    setForm(emptyEnquiry(today));
    setFormError("");
    setFormOpen(true);
  }

  function startEdit(booking: TourBooking) {
    setEditing(booking.id);
    setForm(formFrom(booking));
    setFormError("");
    setFormOpen(true);
  }

  async function save() {
    const problem = enquiryProblem(form);
    if (problem) return setFormError(problem);
    setSaving(true);
    setFormError("");
    try {
      const values: Partial<TourBooking> = {
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim(),
        pickup: form.pickup.trim(),
        dropPlace: form.dropPlace.trim(),
        startDate: form.startDate,
        endDate: form.endDate,
        startAt: toIso(form.startDate, form.startTime),
        endAt: toIso(form.endDate, form.endTime),
        seatsNeeded: form.seats.trim() ? wholeNumber(form.seats) : null,
        note: form.note.trim(),
      };
      if (editing) await updateBooking(supabase, organizationId, editing, values);
      else await createBooking(supabase, organizationId, { ...values, status: "enquiry" });
      setFormOpen(false);
      setEditing(null);
      reload();
    } catch (saveError) {
      setFormError(messageFromUnknown(saveError));
    } finally {
      setSaving(false);
    }
  }

  /** How busy the days of an enquiry are: other enquiries, and tour buses still free. */
  function busyness(booking: TourBooking) {
    const overlaps = (other: TourBooking) =>
      other.id !== booking.id && other.startDate <= booking.endDate && other.endDate >= booking.startDate;
    const others = data.bookings.filter((other) => overlaps(other) && (other.status === "enquiry" || other.status === "quoted"));
    const taken = new Set(
      data.bookings.filter((other) => overlaps(other) && other.status === "confirmed" && other.busId).map((other) => other.busId),
    );
    return { others: others.length, free: data.buses.filter((bus) => !taken.has(bus.id)).length, total: data.buses.length };
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Enquiries & quotes"
        hint="Note an enquiry, send a quote, and confirm the booking when the advance comes in."
        action={
          !org.viewOnly ? (
            <button type="button" onClick={startNew} className="flex min-h-12 items-center gap-2 rounded-2xl bg-brand px-5 text-[15px] font-bold text-white">
              <span aria-hidden="true" className="text-xl leading-none">+</span>
              New enquiry
            </button>
          ) : null
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { id: "open", label: `Open${open.length ? ` (${open.length})` : ""}` },
          { id: "lost", label: "Lost or cancelled" },
        ]}
      />
      <ErrorText message={error} />
      {loading ? <p className="text-sm text-muted">Loading…</p> : null}
      {!loading && data.buses.length === 0 ? (
        <p className="rounded-3xl bg-warn-bg px-4 py-3 text-sm font-semibold text-warn-ink">
          No tour buses yet. Add them on the Buses page before confirming a booking.
        </p>
      ) : null}
      {!loading && shown.length === 0 ? (
        <p className="rounded-3xl bg-white px-4 py-6 text-center text-muted">
          {tab === "open" ? "No open enquiries. Tap “New enquiry” when a customer calls." : "Nothing here."}
        </p>
      ) : null}

      <div className="flex flex-col gap-2.5">
        {shown.map((booking) => {
          const busy = busyness(booking);
          const expired = booking.status === "quoted" && isQuoteExpired(booking, today);
          return (
            <section key={booking.id} className="flex flex-col gap-2 rounded-3xl bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-extrabold">{booking.customerName}</p>
                  <p className="truncate text-sm text-muted">{tripLine(booking)}</p>
                </div>
                <StatusPill status={booking.status}>{expired ? "Quote expired" : undefined}</StatusPill>
              </div>
              <p className="text-sm">{whenLine(booking)}</p>
              <div className="flex flex-wrap gap-1.5">
                {booking.seatsNeeded ? <Chip>{booking.seatsNeeded} people</Chip> : null}
                {booking.customerPhone ? <Chip>{booking.customerPhone}</Chip> : null}
                {booking.status !== "cancelled" && busy.total > 0 ? (
                  <Chip tone={busy.free === 0 ? "bad" : busy.others > 0 ? "warn" : "plain"}>
                    {busy.free} of {busy.total} bus{busy.total === 1 ? "" : "es"} free
                    {busy.others ? ` · ${busy.others} other enquir${busy.others === 1 ? "y" : "ies"}` : ""}
                  </Chip>
                ) : null}
              </div>
              {booking.hireAmountInr > 0 ? (
                <p className="text-sm">
                  <span className="font-bold">
                    {quoteNumber(booking)} · {formatInr(booking.hireAmountInr)}
                  </span>
                  <span className="text-muted">
                    {booking.advanceRequiredInr ? ` · advance ${formatInr(booking.advanceRequiredInr)}` : ""}
                    {booking.quoteValidUntil ? ` · valid till ${longDay(booking.quoteValidUntil)}` : ""}
                  </span>
                </p>
              ) : null}
              {booking.note ? <p className="text-sm text-muted">{booking.note}</p> : null}
              {booking.status === "cancelled" && booking.cancelledReason ? (
                <p className="text-sm text-muted">Reason: {booking.cancelledReason}</p>
              ) : null}

              {!org.viewOnly ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {booking.status === "cancelled" ? (
                    <SmallButton
                      onClick={() =>
                        void updateBooking(supabase, organizationId, booking.id, {
                          status: booking.hireAmountInr > 0 ? "quoted" : "enquiry",
                          cancelledReason: "",
                        }).then(reload)
                      }
                    >
                      Reopen
                    </SmallButton>
                  ) : (
                    <>
                      <SmallButton onClick={() => setQuoting(booking)}>
                        {booking.hireAmountInr > 0 ? "Change quote" : "Make quote"}
                      </SmallButton>
                      {booking.hireAmountInr > 0 ? <SmallButton onClick={() => setSharing(booking)}>Send quote</SmallButton> : null}
                      <SmallButton onClick={() => setConfirming(booking)}>Confirm booking</SmallButton>
                      <SmallButton onClick={() => startEdit(booking)}>Edit</SmallButton>
                      <SmallButton onClick={() => setLosing(booking)}>Mark lost</SmallButton>
                    </>
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      {formOpen ? (
        <Sheet title={editing ? "Edit enquiry" : "New enquiry"} onClose={() => setFormOpen(false)}>
          <label className={LABEL}>
            Customer name
            <input className={FIELD} value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} />
          </label>
          <label className={LABEL}>
            Phone (WhatsApp)
            <input inputMode="tel" className={FIELD} value={form.customerPhone} onChange={(event) => setForm({ ...form, customerPhone: event.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              Pickup from
              <input className={FIELD} value={form.pickup} onChange={(event) => setForm({ ...form, pickup: event.target.value })} />
            </label>
            <label className={LABEL}>
              Going to
              <input className={FIELD} value={form.dropPlace} onChange={(event) => setForm({ ...form, dropPlace: event.target.value })} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              First day
              <input type="date" className={FIELD} value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value, endDate: form.endDate < event.target.value ? event.target.value : form.endDate })} />
            </label>
            <label className={LABEL}>
              Leaving time (optional)
              <input type="time" className={FIELD} value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} />
            </label>
            <label className={LABEL}>
              Last day
              <input type="date" className={FIELD} value={form.endDate} min={form.startDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} />
            </label>
            <label className={LABEL}>
              Return time (optional)
              <input type="time" className={FIELD} value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} />
            </label>
          </div>
          <label className={LABEL}>
            How many people (optional)
            <input inputMode="numeric" className={FIELD} value={form.seats} onChange={(event) => setForm({ ...form, seats: event.target.value })} />
          </label>
          <label className={LABEL}>
            Note (optional)
            <input className={FIELD} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
          </label>
          <ErrorText message={formError} />
          <button type="button" className={PRIMARY} disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : editing ? "Save changes" : "Save enquiry"}
          </button>
        </Sheet>
      ) : null}

      {quoting ? (
        <QuoteForm
          booking={quoting}
          data={data}
          supabase={supabase}
          organizationId={organizationId}
          onClose={() => setQuoting(null)}
          onSaved={(saved) => {
            setQuoting(null);
            reload();
            setSharing(saved);
          }}
        />
      ) : null}

      {sharing ? (
        <QuoteShare
          booking={sharing}
          onClose={() => setSharing(null)}
          onSent={() => {
            const id = sharing.id;
            setSharing(null);
            void updateBooking(supabase, organizationId, id, { quoteSentAt: new Date().toISOString() }).then(reload);
          }}
        />
      ) : null}

      {confirming ? (
        <ConfirmSheet
          booking={confirming}
          data={data}
          supabase={supabase}
          organizationId={organizationId}
          mode="confirm"
          onClose={() => setConfirming(null)}
          onDone={() => {
            setConfirming(null);
            reload();
          }}
        />
      ) : null}

      {losing ? (
        <LostSheet
          booking={losing}
          onClose={() => setLosing(null)}
          onSave={async (reason) => {
            await updateBooking(supabase, organizationId, losing.id, { status: "cancelled", cancelledReason: reason });
            setLosing(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function QuoteForm({
  booking,
  data,
  supabase,
  organizationId,
  onClose,
  onSaved,
}: {
  booking: TourBooking;
  data: TourData;
  supabase: ReturnType<typeof useTourData>["supabase"];
  organizationId: string;
  onClose: () => void;
  onSaved: (saved: TourBooking) => void;
}) {
  const today = todayInIst();
  const [amount, setAmount] = useState(booking.hireAmountInr ? String(booking.hireAmountInr) : "");
  const [advance, setAdvance] = useState(booking.advanceRequiredInr ? String(booking.advanceRequiredInr) : "");
  const [advanceEdited, setAdvanceEdited] = useState(booking.advanceRequiredInr > 0);
  const [days, setDays] = useState(String(data.settings.quoteValidDays));
  const [includes, setIncludes] = useState(booking.inclusions);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // The advance follows the price until someone types their own.
  const price = wholeNumber(amount) ?? 0;
  useEffect(() => {
    if (!advanceEdited) setAdvance(price ? String(suggestedAdvance(price, data.settings.advancePercent)) : "");
  }, [price, advanceEdited, data.settings.advancePercent]);

  async function save() {
    const total = wholeNumber(amount);
    if (!total) return setError("Enter the total price in rupees.");
    const advanceInr = advance.trim() ? wholeNumber(advance) : 0;
    if (advanceInr == null) return setError("Enter the advance in rupees.");
    if (advanceInr > total) return setError("The advance can't be more than the price.");
    const validDays = wholeNumber(days);
    if (!validDays) return setError("Enter how many days the price is valid.");
    setSaving(true);
    setError("");
    try {
      const saved = await updateBooking(supabase, organizationId, booking.id, {
        status: "quoted",
        hireAmountInr: total,
        advanceRequiredInr: advanceInr,
        inclusions: includes.trim(),
        quoteValidUntil: quoteValidUntil(today, validDays),
      });
      onSaved(saved);
    } catch (saveError) {
      setError(messageFromUnknown(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title={`Quote for ${booking.customerName}`} onClose={onClose}>
      <p className="text-sm text-muted">
        {tripLine(booking)} · {whenLine(booking)} · {tourDays(booking)} day{tourDays(booking) === 1 ? "" : "s"}
      </p>
      <label className={LABEL}>
        Total price ₹
        <input inputMode="numeric" className={FIELD} value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          Advance to book ₹
          <input
            inputMode="numeric"
            className={FIELD}
            value={advance}
            onChange={(event) => {
              setAdvance(event.target.value);
              setAdvanceEdited(true);
            }}
          />
        </label>
        <label className={LABEL}>
          Price valid for (days)
          <input inputMode="numeric" className={FIELD} value={days} onChange={(event) => setDays(event.target.value)} />
        </label>
      </div>
      <label className={LABEL}>
        Price includes (one per line)
        <textarea
          className="min-h-24 w-full rounded-2xl bg-canvas px-4 py-3 text-base"
          value={includes}
          onChange={(event) => setIncludes(event.target.value)}
          placeholder={"Diesel\nToll and parking\nDriver bata"}
        />
      </label>
      <ErrorText message={error} />
      <button type="button" className={PRIMARY} disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save and send quote"}
      </button>
    </Sheet>
  );
}

function LostSheet({
  booking,
  onClose,
  onSave,
}: {
  booking: TourBooking;
  onClose: () => void;
  onSave: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Sheet title={`Mark ${booking.customerName} as lost`} onClose={onClose}>
      <label className={LABEL}>
        Why? (optional)
        <input className={FIELD} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Price too high, chose another operator…" />
      </label>
      <ErrorText message={error} />
      <button
        type="button"
        className={PRIMARY}
        disabled={saving}
        onClick={() => {
          setSaving(true);
          onSave(reason.trim()).catch((saveError: unknown) => {
            setError(messageFromUnknown(saveError));
            setSaving(false);
          });
        }}
      >
        {saving ? "Saving…" : "Mark as lost"}
      </button>
    </Sheet>
  );
}

/**
 * Confirms a booking once the advance is in (mode "confirm"), or changes the
 * bus and times of one that is already confirmed (mode "change").
 */
export function ConfirmSheet({
  booking,
  data,
  supabase,
  organizationId,
  mode,
  onClose,
  onDone,
}: {
  booking: TourBooking;
  data: TourData;
  supabase: ReturnType<typeof useTourData>["supabase"];
  organizationId: string;
  mode: "confirm" | "change";
  onClose: () => void;
  onDone: () => void;
}) {
  const today = todayInIst();
  const [busId, setBusId] = useState(booking.busId ?? "");
  const [startTime, setStartTime] = useState(timeOf(booking.startAt));
  const [endTime, setEndTime] = useState(timeOf(booking.endAt));
  const [received, setReceived] = useState(booking.advanceRequiredInr ? String(booking.advanceRequiredInr) : "");
  const [mode2, setMode2] = useState<PayMode>("upi");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const clashes = useMemo(() => {
    const startAt = toIso(booking.startDate, startTime);
    const endAt = toIso(booking.endDate, endTime);
    return new Map(
      data.buses.map((bus) => {
        const candidate: TourBooking = { ...booking, busId: bus.id, status: "confirmed", startAt, endAt };
        return [bus.id, clashFor(candidate, data.bookings, data.settings)] as const;
      }),
    );
  }, [data, startTime, endTime, booking]);
  const clash = busId ? clashes.get(busId) : undefined;
  const timesOk = (startTime && endTime) || (!startTime && !endTime);

  function busLabel(id: string, name: string) {
    const found = clashes.get(id);
    if (found?.kind === "block") return `${name} · already booked`;
    if (found?.kind === "warn") return `${name} · check`;
    return `${name} · free`;
  }

  async function save() {
    if (!busId) return setError("Choose the bus for this tour.");
    if (!timesOk) return setError("Give both the leaving time and the return time, or neither.");
    if (startTime && endTime && `${booking.endDate}T${endTime}` <= `${booking.startDate}T${startTime}`) {
      return setError("The return time must be after the leaving time.");
    }
    if (clash?.kind === "block") return setError("This bus is already booked for those times. Pick another bus or time.");
    let advance = 0;
    if (mode === "confirm") {
      if (!booking.hireAmountInr) return setError("Make a quote first, so the price is on the booking.");
      advance = wholeNumber(received) ?? 0;
      if (!advance) return setError("Enter the advance received. A booking is confirmed once the advance is in.");
    }
    setSaving(true);
    setError("");
    try {
      await updateBooking(supabase, organizationId, booking.id, {
        status: "confirmed",
        busId,
        startAt: toIso(booking.startDate, startTime),
        endAt: toIso(booking.endDate, endTime),
      });
      if (mode === "confirm") {
        try {
          await addTourPayment(supabase, organizationId, {
            bookingId: booking.id,
            receivedOn: today,
            amountInr: advance,
            mode: mode2,
            note: "Advance",
          });
        } catch (payError) {
          setError(`The booking is confirmed, but the advance was not saved: ${messageFromUnknown(payError)} Add it on the Bookings page.`);
          setSaving(false);
          return;
        }
      }
      onDone();
    } catch (saveError) {
      setError(messageFromUnknown(saveError));
      setSaving(false);
    }
  }

  return (
    <Sheet title={mode === "confirm" ? "Confirm booking" : "Change bus or times"} onClose={onClose}>
      <p className="text-sm text-muted">
        {booking.customerName} · {tripLine(booking)} · {whenLine(booking)}
      </p>
      <label className={LABEL}>
        Bus
        <select className={FIELD} value={busId} onChange={(event) => setBusId(event.target.value)}>
          <option value="">Choose a tour bus</option>
          {data.buses.map((bus) => (
            <option key={bus.id} value={bus.id}>
              {busLabel(bus.id, bus.registrationNumber)}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          Leaving time
          <input type="time" className={FIELD} value={startTime} onChange={(event) => setStartTime(event.target.value)} />
        </label>
        <label className={LABEL}>
          Return time
          <input type="time" className={FIELD} value={endTime} onChange={(event) => setEndTime(event.target.value)} />
        </label>
      </div>
      {clash?.kind === "block" ? (
        <p className="rounded-2xl bg-money-out px-4 py-3 text-sm font-semibold text-white">
          This bus is already booked for those times ({clash.other.customerName}, {whenLine(clash.other)}). Pick another bus or time.
        </p>
      ) : null}
      {clash?.kind === "warn" ? (
        <p className="rounded-2xl bg-warn-bg px-4 py-3 text-sm font-semibold text-warn-ink">
          {clash.reason === "short_gap"
            ? `Less than ${data.settings.turnaroundHours} hours between this tour and ${clash.other.customerName}'s (${whenLine(clash.other)}). You can still confirm.`
            : `${clash.other.customerName}'s tour (${whenLine(clash.other)}) has no exact times, so the bus may be busy. Add leaving and return times to be sure. You can still confirm.`}
        </p>
      ) : null}
      {!startTime && !endTime ? (
        <p className="text-xs text-muted">With no times, this tour holds the bus for the whole days.</p>
      ) : null}
      {mode === "confirm" ? (
        <>
          <p className="text-sm font-bold">
            Price {formatInr(booking.hireAmountInr)}
            {booking.advanceRequiredInr ? ` · advance asked ${formatInr(booking.advanceRequiredInr)}` : ""}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              Advance received ₹
              <input inputMode="numeric" className={FIELD} value={received} onChange={(event) => setReceived(event.target.value)} />
            </label>
            <label className={LABEL}>
              Paid by
              <select className={FIELD} value={mode2} onChange={(event) => setMode2(event.target.value as PayMode)}>
                {PAY_MODES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      ) : null}
      <ErrorText message={error} />
      <button type="button" className={PRIMARY} disabled={saving || clash?.kind === "block"} onClick={() => void save()}>
        {saving ? "Saving…" : mode === "confirm" ? "Confirm booking" : "Save changes"}
      </button>
    </Sheet>
  );
}

