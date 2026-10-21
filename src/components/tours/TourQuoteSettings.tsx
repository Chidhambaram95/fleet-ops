"use client";

import { useEffect, useMemo, useState } from "react";
import { getTourSettings, saveTourSettings } from "@data/tours/repository";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { ErrorText, FIELD, LABEL, PRIMARY, messageFromUnknown, wholeNumber } from "@/components/ui/kit";

/** Company defaults for tour quotes: how long a quote holds, the advance asked, the bus turnaround. */
export function TourQuoteSettings({ organizationId, viewOnly }: { organizationId: string; viewOnly: boolean }) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [days, setDays] = useState("3");
  const [percent, setPercent] = useState("25");
  const [hours, setHours] = useState("3");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getTourSettings(supabase, organizationId)
      .then((settings) => {
        setDays(String(settings.quoteValidDays));
        setPercent(String(settings.advancePercent));
        setHours(String(settings.turnaroundHours));
      })
      .catch(() => undefined);
  }, [supabase, organizationId]);

  async function save() {
    const quoteValidDays = wholeNumber(days);
    const advancePercent = wholeNumber(percent);
    const turnaroundHours = wholeNumber(hours);
    setFailed(true);
    if (!quoteValidDays || quoteValidDays > 60) return setMessage("Quote validity must be 1 to 60 days.");
    if (advancePercent == null || advancePercent > 100) return setMessage("Advance must be 0 to 100 percent.");
    if (turnaroundHours == null || turnaroundHours > 24) return setMessage("Turnaround must be 0 to 24 hours.");
    setBusy(true);
    try {
      await saveTourSettings(supabase, organizationId, { quoteValidDays, advancePercent, turnaroundHours });
      setFailed(false);
      setMessage("Saved.");
    } catch (error) {
      setMessage(messageFromUnknown(error));
    }
    setBusy(false);
  }

  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-white p-4 md:p-5">
      <div>
        <h2 className="font-extrabold">Tour quotes</h2>
        <p className="text-sm text-muted">Starting values for every new quote. You can change them on each quote.</p>
      </div>
      <fieldset disabled={viewOnly} className="grid gap-3 md:grid-cols-3">
        <label className={LABEL}>
          Quote is valid for (days)
          <input inputMode="numeric" className={FIELD} value={days} onChange={(event) => setDays(event.target.value)} />
        </label>
        <label className={LABEL}>
          Advance to book (% of price)
          <input inputMode="numeric" className={FIELD} value={percent} onChange={(event) => setPercent(event.target.value)} />
        </label>
        <label className={LABEL}>
          Gap between tours (hours)
          <input inputMode="numeric" className={FIELD} value={hours} onChange={(event) => setHours(event.target.value)} />
        </label>
      </fieldset>
      <p className="text-xs text-muted">
        The gap is the time a bus needs between two tours on the same day. A shorter gap shows a warning.
      </p>
      {failed ? <ErrorText message={message} /> : message ? <p className="text-sm text-money-in">{message}</p> : null}
      {viewOnly ? null : (
        <button type="button" className={PRIMARY} disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save quote settings"}
        </button>
      )}
    </section>
  );
}
