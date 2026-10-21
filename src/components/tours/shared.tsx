"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { getTourSettings, listBookings, listTourPayments } from "@data/tours/repository";
import type { Bus } from "@domain/operations/types";
import { formatInr } from "@domain/operations/totals";
import { balanceDue } from "@domain/tours/calc";
import { inclusionItems, longDay, quoteMessage, quoteNumber, tripLine, whenLine } from "@domain/tours/messages";
import {
  DEFAULT_TOUR_SETTINGS,
  type TourBooking,
  type TourPayment,
  type TourSettings,
  type TourStatus,
} from "@domain/tours/types";
import { useOrg } from "@/components/billing/OrgContext";
import { drawQuoteImage } from "@/lib/quoteImage";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { ErrorText, PRIMARY, SECONDARY, messageFromUnknown, useLoaded } from "@/components/ui/kit";

export type TourData = {
  bookings: TourBooking[];
  payments: TourPayment[];
  buses: Bus[];
  settings: TourSettings;
};

const EMPTY: TourData = { bookings: [], payments: [], buses: [], settings: DEFAULT_TOUR_SETTINGS };

/** Everything the tour screens need, for one company. */
export function useTourData(organizationId: string) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const state = useLoaded<TourData>(
    async () => {
      const [bookings, payments, buses, settings] = await Promise.all([
        listBookings(supabase, organizationId),
        listTourPayments(supabase, organizationId),
        createSupabaseOperationsRepository(supabase).listBuses(organizationId),
        getTourSettings(supabase, organizationId),
      ]);
      return { bookings, payments, buses: buses.filter((bus) => bus.busType === "tour"), settings };
    },
    EMPTY,
  );
  return { supabase, ...state };
}

/** A date and an optional clock time (IST) as an ISO timestamp, or null when there is no time. */
export function toIso(date: string, time: string) {
  return date && time ? `${date}T${time}:00+05:30` : null;
}

/** "HH:MM" in IST from an ISO timestamp. */
export function timeOf(iso: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export const STATUS_LABEL: Record<TourStatus, string> = {
  enquiry: "Enquiry",
  quoted: "Quote sent",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_CLASS: Record<TourStatus, string> = {
  enquiry: "bg-brand-soft text-brand",
  quoted: "bg-warn-bg text-warn-ink",
  confirmed: "bg-[#E3F2EA] text-money-in",
  completed: "bg-canvas text-muted",
  cancelled: "bg-canvas text-muted",
};

export function StatusPill({ status, children }: { status: TourStatus; children?: ReactNode }) {
  return (
    <span className={`inline-flex min-h-7 items-center whitespace-nowrap rounded-full px-3 text-xs font-bold ${STATUS_CLASS[status]}`}>
      {children ?? STATUS_LABEL[status]}
    </span>
  );
}

export function Chip({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "warn" | "bad" }) {
  const cls =
    tone === "warn" ? "bg-warn-bg text-warn-ink" : tone === "bad" ? "bg-money-out text-white" : "bg-canvas text-muted";
  return <span className={`inline-flex min-h-7 items-center rounded-full px-3 text-xs font-bold ${cls}`}>{children}</span>;
}

/** A bottom sheet on the phone and a centred card on the laptop. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-t-3xl bg-white p-5 md:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button type="button" onClick={onClose} className="h-10 rounded-full bg-canvas px-4 text-sm font-bold text-muted">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function openWhatsApp(digits: string, text: string) {
  const base = digits ? `https://wa.me/${digits}` : "https://wa.me/";
  window.open(`${base}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

/** The quote as a small picture, ready to send on WhatsApp. */
export function QuoteShare({
  booking,
  onClose,
  onSent,
}: {
  booking: TourBooking;
  onClose: () => void;
  onSent: () => void;
}) {
  const org = useOrg();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const phone = org.whatsappNumber ? org.whatsappNumber.replace(/^91(?=\d{10}$)/, "") : "";

  useEffect(() => {
    let cancelled = false;
    let made = "";
    drawQuoteImage({
      company: org.name,
      phone,
      quoteNo: quoteNumber(booking),
      customer: booking.customerName,
      trip: tripLine(booking),
      when: whenLine(booking),
      people: booking.seatsNeeded ? `${booking.seatsNeeded} people` : "",
      total: formatInr(booking.hireAmountInr),
      advance: booking.advanceRequiredInr ? formatInr(booking.advanceRequiredInr) : "",
      includes: inclusionItems(booking.inclusions),
      validTill: booking.quoteValidUntil ? longDay(booking.quoteValidUntil) : "",
    })
      .then((next) => {
        if (cancelled) return;
        made = URL.createObjectURL(next);
        setBlob(next);
        setUrl(made);
      })
      .catch((drawError: unknown) => !cancelled && setError(messageFromUnknown(drawError)));
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [booking, org.name, phone]);

  const fileName = `${org.name.replace(/[^A-Za-z0-9]+/g, "_")}_Quote_${quoteNumber(booking)}.png`;
  const text = quoteMessage(org.name, booking, phone);

  function download() {
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
  }

  async function send() {
    if (!blob) return;
    setError("");
    const file = new File([blob], fileName, { type: "image/png" });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
      } else {
        // Computers can't attach to WhatsApp from a web page: save the picture, then open the chat.
        download();
        const digits = booking.customerPhone.replace(/\D/g, "");
        openWhatsApp(digits.length === 10 ? `91${digits}` : digits, text);
      }
      onSent();
    } catch (shareError) {
      // Closing the share sheet is not an error.
      if (!(shareError instanceof DOMException && shareError.name === "AbortError")) {
        setError(messageFromUnknown(shareError));
      }
    }
  }
  return (
    <Sheet title={`Quote ${quoteNumber(booking)}`} onClose={onClose}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Quote" className="w-full rounded-2xl border border-line" />
      ) : (
        <p className="py-10 text-center text-muted">Making the quote picture…</p>
      )}
      <ErrorText message={error} />
      <button type="button" className={PRIMARY} disabled={!blob} onClick={() => void send()}>
        Send on WhatsApp
      </button>
      <button type="button" className={SECONDARY} disabled={!blob} onClick={download}>
        Download picture
      </button>
      <p className="text-xs text-muted">
        On a phone this attaches the picture to WhatsApp. On a computer it saves the picture and opens the chat with
        the message; add the picture there.
      </p>
    </Sheet>
  );
}

export function balanceOf(booking: TourBooking, payments: TourPayment[]) {
  return balanceDue(booking, payments);
}
