"use client";

import Link from "next/link";
import { useState } from "react";
import { addTourPayment, deleteTourPayment, updateBooking } from "@data/tours/repository";
import { formatInr, todayInIst } from "@domain/operations/totals";
import { balanceDue, receivedTotal, whatsappDigits } from "@domain/tours/calc";
import { confirmationMessage, longDay, quoteNumber, reminderMessage, tripLine, whenLine } from "@domain/tours/messages";
import { PAY_MODES, type PayMode, type TourBooking } from "@domain/tours/types";
import { useOrg } from "@/components/billing/OrgContext";
import {
  Empty,
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
import { ConfirmSheet } from "./EnquiriesPage";
import { Chip, Sheet, StatusPill, openWhatsApp, useTourData, type TourData } from "./shared";

type Tab = "upcoming" | "done";

/** Confirmed tours: who is paying what, and the trip sheet for each. */
export function BookingsPage({ organizationId }: { organizationId: string }) {
  const org = useOrg();
  const today = todayInIst();
  const { supabase, data, loading, error, reload } = useTourData(organizationId);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [paying, setPaying] = useState<TourBooking | null>(null);
  const [changing, setChanging] = useState<TourBooking | null>(null);
  const [cancelling, setCancelling] = useState<TourBooking | null>(null);
  const [actionError, setActionError] = useState("");

  const upcoming = data.bookings
    .filter((item) => item.status === "confirmed")
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
  const done = data.bookings
    .filter((item) => item.status === "completed")
    .sort((left, right) => right.startDate.localeCompare(left.startDate));
  const shown = tab === "upcoming" ? upcoming : done;
  const busName = (id: string | null) => data.buses.find((bus) => bus.id === id)?.registrationNumber ?? "No bus";

  async function setStatus(booking: TourBooking, status: "completed" | "confirmed") {
    setActionError("");
    try {
      await updateBooking(supabase, organizationId, booking.id, { status });
      reload();
    } catch (statusError) {
      setActionError(messageFromUnknown(statusError));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Bookings" hint={loading ? "Loading…" : `${upcoming.length} confirmed`} />
      <ErrorText message={error || actionError} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { id: "upcoming", label: `Upcoming & running (${upcoming.length})` },
          { id: "done", label: `Completed (${done.length})` },
        ]}
      />
      {!loading && shown.length === 0 ? (
        <Empty>{tab === "upcoming" ? "No confirmed bookings. Confirm one from Enquiries & quotes." : "No completed tours yet."}</Empty>
      ) : null}
      {shown.map((booking) => {
        const received = receivedTotal(booking.id, data.payments);
        const balance = balanceDue(booking, data.payments);
        const running = booking.status === "confirmed" && booking.startDate <= today && booking.endDate >= today;
        const phone = whatsappDigits(booking.customerPhone);
        return (
          <section key={booking.id} className="flex flex-col gap-3 rounded-3xl bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-lg font-extrabold">{booking.customerName}</p>
                <p className="text-sm text-muted">
                  {booking.customerPhone || "No phone"} · {quoteNumber(booking)}
                </p>
              </div>
              <StatusPill status={booking.status}>{running ? "Running now" : undefined}</StatusPill>
            </div>
            <p className="text-sm">
              <span className="font-bold">{busName(booking.busId)}</span> · {tripLine(booking)}
              <br />
              <span className="text-muted">{whenLine(booking)}</span>
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Figure label="Hire" value={formatInr(booking.hireAmountInr)} />
              <Figure label="Received" value={formatInr(received)} tone="in" />
              <Figure label="Balance" value={formatInr(balance)} tone={balance ? "out" : undefined} />
            </div>
            {booking.status === "confirmed" ? (
              <div className="flex flex-wrap items-center gap-1">
                {booking.tripId ? (
                  <Link className="px-2 text-[13px] font-semibold text-brand" href={`/tour/trips/${booking.tripId}`}>
                    Open trip sheet
                  </Link>
                ) : !org.viewOnly ? (
                  <Link className="px-2 text-[13px] font-semibold text-brand" href={`/tour/trips/new?booking=${booking.id}`}>
                    Start trip sheet
                  </Link>
                ) : null}
                {!org.viewOnly ? <SmallButton tone="brand" onClick={() => setPaying(booking)}>Receive payment</SmallButton> : null}
                <SmallButton
                  onClick={() =>
                    openWhatsApp(
                      phone,
                      confirmationMessage(org.name, booking, busName(booking.busId), received, balance),
                    )
                  }
                >
                  WhatsApp confirmation
                </SmallButton>
                {balance > 0 ? (
                  <SmallButton onClick={() => openWhatsApp(phone, reminderMessage(org.name, booking, balance))}>
                    Remind balance
                  </SmallButton>
                ) : null}
                {!org.viewOnly ? (
                  <>
                    <SmallButton onClick={() => setChanging(booking)}>Change bus or times</SmallButton>
                    <SmallButton onClick={() => void setStatus(booking, "completed")}>Mark completed</SmallButton>
                    <SmallButton onClick={() => setCancelling(booking)}>Cancel</SmallButton>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1">
                {booking.tripId ? (
                  <Link className="px-2 text-[13px] font-semibold text-brand" href={`/tour/trips/${booking.tripId}`}>
                    Open trip sheet
                  </Link>
                ) : null}
                {balance > 0 ? (
                  <>
                    {!org.viewOnly ? <SmallButton tone="brand" onClick={() => setPaying(booking)}>Receive payment</SmallButton> : null}
                    <SmallButton onClick={() => openWhatsApp(phone, reminderMessage(org.name, booking, balance))}>
                      Remind balance
                    </SmallButton>
                  </>
                ) : (
                  <Chip>Fully paid</Chip>
                )}
                {!org.viewOnly ? <SmallButton onClick={() => void setStatus(booking, "confirmed")}>Reopen</SmallButton> : null}
              </div>
            )}
          </section>
        );
      })}
      {paying ? (
        <PaymentSheet
          booking={paying}
          data={data}
          supabase={supabase}
          organizationId={organizationId}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            reload();
          }}
        />
      ) : null}
      {changing ? (
        <ConfirmSheet
          booking={changing}
          data={data}
          supabase={supabase}
          organizationId={organizationId}
          mode="change"
          onClose={() => setChanging(null)}
          onDone={() => {
            setChanging(null);
            reload();
          }}
        />
      ) : null}
      {cancelling ? (
        <CancelSheet
          booking={cancelling}
          supabase={supabase}
          organizationId={organizationId}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "in" | "out" }) {
  return (
    <div className="rounded-2xl bg-canvas px-2 py-2">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`font-extrabold ${tone === "in" ? "text-money-in" : tone === "out" ? "text-money-out" : ""}`}>{value}</p>
    </div>
  );
}

function PaymentSheet({
  booking,
  data,
  supabase,
  organizationId,
  onClose,
  onDone,
}: {
  booking: TourBooking;
  data: TourData;
  supabase: ReturnType<typeof useTourData>["supabase"];
  organizationId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const balance = balanceDue(booking, data.payments);
  const [amount, setAmount] = useState(balance ? String(balance) : "");
  const [mode, setMode] = useState<PayMode>("upi");
  const [date, setDate] = useState(todayInIst());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const mine = data.payments.filter((payment) => payment.bookingId === booking.id);

  async function save() {
    const value = wholeNumber(amount);
    if (!value) return setError("Enter the amount received.");
    setSaving(true);
    setError("");
    try {
      await addTourPayment(supabase, organizationId, {
        bookingId: booking.id,
        receivedOn: date,
        amountInr: value,
        mode,
        note: note.trim(),
      });
      onDone();
    } catch (saveError) {
      setError(messageFromUnknown(saveError));
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this payment?")) return;
    try {
      await deleteTourPayment(supabase, organizationId, id);
      onDone();
    } catch (deleteError) {
      setError(messageFromUnknown(deleteError));
    }
  }

  return (
    <Sheet title="Receive payment" onClose={onClose}>
      <p className="text-sm text-muted">
        {booking.customerName} · hire {formatInr(booking.hireAmountInr)} · balance {formatInr(balance)}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          Amount ₹
          <input inputMode="numeric" className={FIELD} value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        <label className={LABEL}>
          Paid by
          <select className={FIELD} value={mode} onChange={(event) => setMode(event.target.value as PayMode)}>
            {PAY_MODES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={LABEL}>
        Date received
        <input type="date" className={FIELD} value={date} onChange={(event) => setDate(event.target.value)} />
      </label>
      <label className={LABEL}>
        Note (optional)
        <input className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <ErrorText message={error} />
      <button type="button" className={PRIMARY} disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save payment"}
      </button>
      {mine.length ? (
        <div className="flex flex-col">
          <p className="text-sm font-bold">Payments so far</p>
          {mine.map((payment) => (
            <div key={payment.id} className="flex items-center justify-between gap-2 border-t border-line py-2 text-sm">
              <span>
                {longDay(payment.receivedOn)} · {payment.mode.toUpperCase()}
                {payment.note ? ` · ${payment.note}` : ""}
              </span>
              <span className="flex items-center gap-1">
                <b className="text-money-in">{formatInr(payment.amountInr)}</b>
                <SmallButton onClick={() => void remove(payment.id)}>Delete</SmallButton>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </Sheet>
  );
}

function CancelSheet({
  booking,
  supabase,
  organizationId,
  onClose,
  onDone,
}: {
  booking: TourBooking;
  supabase: ReturnType<typeof useTourData>["supabase"];
  organizationId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  async function save() {
    try {
      await updateBooking(supabase, organizationId, booking.id, { status: "cancelled", cancelledReason: reason.trim() });
      onDone();
    } catch (saveError) {
      setError(messageFromUnknown(saveError));
    }
  }
  return (
    <Sheet title="Cancel booking" onClose={onClose}>
      <p className="text-sm text-muted">
        {booking.customerName} · {tripLine(booking)}. Payments already received stay on record.
      </p>
      <label className={LABEL}>
        Reason (optional)
        <input className={FIELD} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <ErrorText message={error} />
      <button type="button" className={PRIMARY} onClick={() => void save()}>
        Cancel this booking
      </button>
    </Sheet>
  );
}
