"use client";

import { useEffect, useMemo, useState } from "react";
import { getTyreLifeSettings, saveTyreLifeSettings } from "@data/tyres/repository";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { ErrorText, FIELD, LABEL, PRIMARY, messageFromUnknown, wholeNumber } from "@/components/ui/kit";

/** Company defaults for how far a tyre should run, used for the health colours when a tyre has no warranty km. */
export function TyreLifeSettings({ organizationId, viewOnly }: { organizationId: string; viewOnly: boolean }) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [newKm, setNewKm] = useState("80000");
  const [retreadKm, setRetreadKm] = useState("40000");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getTyreLifeSettings(supabase, organizationId)
      .then((settings) => {
        setNewKm(String(settings.newLifeKm));
        setRetreadKm(String(settings.retreadLifeKm));
      })
      .catch(() => undefined);
  }, [supabase, organizationId]);

  async function save() {
    const newLifeKm = wholeNumber(newKm);
    const retreadLifeKm = wholeNumber(retreadKm);
    setFailed(true);
    if (!newLifeKm || newLifeKm < 1000 || newLifeKm > 1000000) return setMessage("New tyre km must be 1,000 to 10,00,000.");
    if (!retreadLifeKm || retreadLifeKm < 1000 || retreadLifeKm > 1000000) {
      return setMessage("Retread km must be 1,000 to 10,00,000.");
    }
    setBusy(true);
    try {
      await saveTyreLifeSettings(supabase, organizationId, { newLifeKm, retreadLifeKm });
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
        <h2 className="font-extrabold">Tyre life</h2>
        <p className="text-sm text-muted">
          How far a tyre should run when it has no warranty km of its own. The tyre colours turn amber at 70% and red at
          90% of this.
        </p>
      </div>
      <fieldset disabled={viewOnly} className="grid gap-3 md:grid-cols-2">
        <label className={LABEL}>
          New tyre (km)
          <input inputMode="numeric" className={FIELD} value={newKm} onChange={(event) => setNewKm(event.target.value)} />
        </label>
        <label className={LABEL}>
          After each retread (km)
          <input inputMode="numeric" className={FIELD} value={retreadKm} onChange={(event) => setRetreadKm(event.target.value)} />
        </label>
      </fieldset>
      {failed ? <ErrorText message={message} /> : message ? <p className="text-sm text-money-in">{message}</p> : null}
      {viewOnly ? null : (
        <button type="button" className={PRIMARY} disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save tyre life"}
        </button>
      )}
    </section>
  );
}
