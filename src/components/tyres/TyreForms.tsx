"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addTyre, moveTyre, updateTyre, uploadTyreBill } from "@data/tyres/repository";
import { formatInr, todayInIst } from "@domain/operations/totals";
import {
  REMOVAL_REASONS,
  ROAD_POSITIONS,
  positionLabel,
  sparePosition,
  spareCount,
} from "@domain/tyres/catalog";
import type { NewTyre, Tyre, TyreMove } from "@domain/tyres/types";
import { compressReceipt } from "@/lib/compressReceipt";
import {
  Card,
  ErrorText,
  FIELD,
  LABEL,
  PRIMARY,
  SECONDARY,
  messageFromUnknown,
  wholeNumber,
} from "@/components/ui/kit";

export type BusOption = { id: string; registrationNumber: string };

export type MoveMode = "fit" | "rotate" | "remove" | "retread_out" | "retread_in" | "repair" | "scrap";

const MODE_TITLES: Record<MoveMode, string> = {
  fit: "Fit tyre",
  rotate: "Rotate on the same bus",
  remove: "Remove tyre",
  retread_out: "Send for retread",
  retread_in: "Back from retread",
  repair: "Repair",
  scrap: "Scrap tyre",
};

/** Every position a bus can take: six road wheels, its spares in use and one more spare. */
export function positionsFor(busId: string, tyres: Tyre[]): string[] {
  const inUse = tyres
    .filter((tyre) => tyre.status === "fitted" && tyre.currentBusId === busId)
    .map((tyre) => tyre.currentPosition);
  const spares = spareCount(inUse, 1);
  return [...ROAD_POSITIONS.map((item) => item.id), ...Array.from({ length: spares }, (_, i) => sparePosition(i + 1))];
}

function occupant(tyres: Tyre[], busId: string, position: string, except?: string) {
  return tyres.find(
    (tyre) =>
      tyre.status === "fitted" && tyre.currentBusId === busId && tyre.currentPosition === position && tyre.id !== except,
  );
}

function optionalNumber(value: string): { ok: boolean; value: number | null } {
  if (!value.trim()) return { ok: true, value: null };
  const parsed = wholeNumber(value);
  return parsed == null ? { ok: false, value: null } : { ok: true, value: parsed };
}

/**
 * Every tyre move in one form: fit, rotate, remove (and what happens next),
 * send for retread, back from retread (and fit straight away), repair, scrap.
 */
export function MoveForm({
  supabase,
  mode,
  tyre,
  slot,
  tyres,
  buses,
  odometers,
  onDone,
  onCancel,
}: {
  supabase: SupabaseClient;
  mode: MoveMode;
  /** The tyre being moved. Empty when fitting from an empty spot on a bus. */
  tyre: Tyre | null;
  /** An empty spot tapped on a bus. */
  slot?: { busId: string; position: string } | null;
  tyres: Tyre[];
  buses: BusOption[];
  odometers: Map<string, number>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const today = todayInIst();
  const busName = (id: string | null) => buses.find((bus) => bus.id === id)?.registrationNumber ?? "Bus";
  const startBus = slot?.busId ?? (mode === "rotate" ? (tyre?.currentBusId ?? "") : "");
  const odometerOf = (busId: string) => (busId && odometers.has(busId) ? String(odometers.get(busId)) : "");

  const [tyreId, setTyreId] = useState(tyre?.id ?? "");
  const [busId, setBusId] = useState(startBus);
  const [position, setPosition] = useState(slot?.position ?? "");
  const [date, setDate] = useState(today);
  const [odometer, setOdometer] = useState(() =>
    odometerOf(mode === "remove" || mode === "rotate" ? (tyre?.currentBusId ?? "") : startBus),
  );
  const [cost, setCost] = useState("");
  const [vendor, setVendor] = useState("");
  const [reason, setReason] = useState(mode === "remove" ? REMOVAL_REASONS[0] : "");
  const [note, setNote] = useState("");
  /** Remove: what happens to the tyre next. */
  const [after, setAfter] = useState<"stock" | "retread" | "scrap">("retread");
  /** Back from retread: fit it straight away. */
  const [fitNow, setFitNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const moving = tyre ?? tyres.find((item) => item.id === tyreId) ?? null;
  const stock = useMemo(
    () => tyres.filter((item) => item.status === "in_stock").sort((a, b) => a.tyreNumber.localeCompare(b.tyreNumber)),
    [tyres],
  );
  const fitting = mode === "fit" || (mode === "retread_in" && fitNow);
  const positions = busId ? positionsFor(busId, tyres) : [];
  const swapWith = mode === "rotate" && busId && position ? occupant(tyres, busId, position, moving?.id) : undefined;
  const pending =
    (moving?.unchargedInr ?? 0) + (mode === "retread_in" ? (optionalNumber(cost).value ?? 0) : 0);

  function pickBus(next: string) {
    setBusId(next);
    setPosition("");
    setOdometer(odometerOf(next));
  }

  async function save() {
    if (!moving) return setError("Pick the tyre.");
    if (!date) return setError("Enter the date.");
    const odo = optionalNumber(odometer);
    if (!odo.ok) return setError("Enter the odometer in km.");
    const money = optionalNumber(cost);
    if (!money.ok) return setError("Enter the amount in rupees.");
    if (fitting || mode === "rotate") {
      if (!busId) return setError("Pick the bus.");
      if (!position) return setError("Pick the wheel position.");
    }
    if ((fitting || mode === "rotate" || mode === "remove") && odo.value == null) {
      return setError("Enter the odometer reading. It is used to work out the km on this tyre.");
    }
    if (mode === "retread_in" && money.value == null) return setError("Enter the retread bill.");
    if (mode === "repair" && money.value == null) return setError("Enter the repair bill.");

    const moves: TyreMove[] = [];
    switch (mode) {
      case "fit":
        moves.push({ kind: "fitted", date, busId, position, odometerKm: odo.value, note });
        break;
      case "rotate":
        moves.push({ kind: "rotated", date, position, odometerKm: odo.value, note });
        break;
      case "remove":
        moves.push({ kind: "removed", date, odometerKm: odo.value, reason, note });
        if (after === "retread") moves.push({ kind: "sent_for_retread", date, vendor });
        if (after === "scrap") moves.push({ kind: "scrapped", date, reason });
        break;
      case "retread_out":
        moves.push({ kind: "sent_for_retread", date, vendor, note });
        break;
      case "retread_in":
        moves.push({ kind: "retread_received", date, costInr: money.value, vendor, note });
        if (fitNow) moves.push({ kind: "fitted", date, busId, position, odometerKm: odo.value });
        break;
      case "repair":
        moves.push({ kind: "repair", date, costInr: money.value, vendor, reason, note });
        break;
      case "scrap":
        moves.push({ kind: "scrapped", date, reason, note });
        break;
    }

    setSaving(true);
    setError("");
    try {
      for (const move of moves) {
        await moveTyre(supabase, moving.id, move);
      }
      onDone();
    } catch (saveError) {
      setError(messageFromUnknown(saveError));
    } finally {
      setSaving(false);
    }
  }

  const busAndPosition = (
    <>
      <label className={LABEL}>
        Bus
        <select className={FIELD} value={busId} disabled={mode === "rotate" || !!slot} onChange={(event) => pickBus(event.target.value)}>
          <option value="">Pick a bus</option>
          {buses.map((bus) => (
            <option key={bus.id} value={bus.id}>
              {bus.registrationNumber}
            </option>
          ))}
        </select>
      </label>
      {busId ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[13px] font-semibold">
            {mode === "rotate" ? "Move to" : "Wheel position"}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {positions.map((id) => {
              const there = occupant(tyres, busId, id, moving?.id);
              const current = mode === "rotate" && id === moving?.currentPosition;
              // Fitting needs an empty spot; rotating can swap with the tyre that is there.
              const blocked = current || (mode !== "rotate" && !!there);
              return (
                <button
                  key={id}
                  type="button"
                  disabled={blocked}
                  aria-pressed={position === id}
                  onClick={() => setPosition(id)}
                  className={`min-h-12 rounded-2xl px-3 py-2 text-left text-sm disabled:opacity-40 ${
                    position === id ? "bg-brand text-white" : "bg-canvas"
                  }`}
                >
                  <span className="block font-bold">{positionLabel(id)}</span>
                  <span className={`block text-xs ${position === id ? "text-brand-pale" : "text-muted"}`}>
                    {current ? "Here now" : there ? (mode === "rotate" ? `Swap with ${there.tyreNumber}` : there.tyreNumber) : "Empty"}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </>
  );

  return (
    <Card title={`${MODE_TITLES[mode]}${moving ? ` · ${moving.tyreNumber}` : ""}`}>
      {mode === "fit" && !tyre ? (
        <label className={LABEL}>
          Tyre from stock
          <select className={FIELD} value={tyreId} onChange={(event) => setTyreId(event.target.value)}>
            <option value="">{stock.length ? "Pick a tyre" : "No tyres in stock"}</option>
            {stock.map((item) => (
              <option key={item.id} value={item.id}>
                {item.tyreNumber}
                {item.brand ? ` · ${item.brand}` : ""}
                {item.retreadCount ? ` · retread ${item.retreadCount}×` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {mode === "remove" && moving ? (
        <p className="text-sm text-muted">
          On {busName(moving.currentBusId)} · {positionLabel(moving.currentPosition)}
          {moving.fittedOdometerKm != null ? ` since ${moving.fittedOdometerKm.toLocaleString("en-IN")} km` : ""}
        </p>
      ) : null}

      {mode === "retread_in" ? (
        <p className="rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand">
          The tyre keeps its number, {moving?.tyreNumber}. The retread bill is charged to the next bus it is fitted on.
        </p>
      ) : null}

      {mode === "fit" || mode === "rotate" ? busAndPosition : null}

      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          Date
          <input type="date" className={FIELD} max={today} value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        {fitting || mode === "rotate" || mode === "remove" ? (
          <label className={LABEL}>
            Odometer km
            <input inputMode="numeric" className={FIELD} value={odometer} onChange={(event) => setOdometer(event.target.value)} />
          </label>
        ) : null}
        {mode === "retread_in" || mode === "repair" ? (
          <label className={LABEL}>
            {mode === "repair" ? "Repair bill ₹" : "Retread bill ₹"}
            <input inputMode="numeric" className={FIELD} value={cost} onChange={(event) => setCost(event.target.value)} />
          </label>
        ) : null}
      </div>

      {fitting || mode === "rotate" ? (
        <p className="-mt-1 text-xs text-muted">
          {busId && odometers.has(busId)
            ? `Filled in from the last reading for ${busName(busId)}. Change it if the bus has run since.`
            : "Read it off the bus's odometer."}
        </p>
      ) : null}

      {mode === "rotate" && swapWith ? (
        <p className="rounded-2xl bg-warn-bg px-4 py-3 text-sm text-warn-ink">
          {swapWith.tyreNumber} moves to {positionLabel(moving?.currentPosition)}, and {moving?.tyreNumber} moves to{" "}
          {positionLabel(position)}.
        </p>
      ) : null}

      {mode === "remove" ? (
        <>
          <label className={LABEL}>
            Why
            <select className={FIELD} value={reason} onChange={(event) => setReason(event.target.value)}>
              {REMOVAL_REASONS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[13px] font-semibold">Then</legend>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["retread", "Send for retread"],
                  ["stock", "Keep in stock"],
                  ["scrap", "Scrap it"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={after === id}
                  onClick={() => setAfter(id)}
                  className={`min-h-12 rounded-2xl px-2 text-sm font-bold ${after === id ? "bg-brand text-white" : "bg-canvas text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        </>
      ) : null}

      {mode === "retread_out" || mode === "retread_in" || mode === "repair" || (mode === "remove" && after === "retread") ? (
        <label className={LABEL}>
          {mode === "repair" ? "Shop (optional)" : "Retreader (optional)"}
          <input className={FIELD} placeholder="e.g. Sri Murugan Retreads" value={vendor} onChange={(event) => setVendor(event.target.value)} />
        </label>
      ) : null}

      {mode === "repair" || mode === "scrap" ? (
        <label className={LABEL}>
          {mode === "repair" ? "What was done" : "Why"}
          <input
            className={FIELD}
            placeholder={mode === "repair" ? "e.g. Puncture" : "e.g. Burst, sidewall cut"}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      ) : null}

      {mode === "repair" && moving ? (
        <p className="-mt-1 text-xs text-muted">
          {moving.status === "fitted"
            ? `Charged to ${busName(moving.currentBusId)}.`
            : "The tyre is off a bus, so this is charged to the next bus it is fitted on."}
        </p>
      ) : null}

      {mode === "retread_in" ? (
        <label className="flex items-center gap-3 text-sm font-semibold">
          <input type="checkbox" className="h-5 w-5" checked={fitNow} onChange={(event) => setFitNow(event.target.checked)} />
          Fit it to a bus now
        </label>
      ) : null}
      {mode === "retread_in" && fitNow ? busAndPosition : null}

      {fitting && moving && pending > 0 ? (
        <p className="rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand">
          {formatInr(pending)} {moving.retreadCount || mode === "retread_in" ? "(retread and repair bills)" : "(purchase price)"} will be charged to{" "}
          {busId ? busName(busId) : "this bus"}.
        </p>
      ) : null}

      <label className={LABEL}>
        Note (optional)
        <input className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <ErrorText message={error} />
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className={SECONDARY} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={PRIMARY} disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Card>
  );
}

type TyreDraft = {
  tyreNumber: string;
  brand: string;
  size: string;
  boughtAs: "new" | "retreaded";
  purchaseDate: string;
  price: string;
  vendor: string;
  warrantyMonths: string;
  warrantyKm: string;
  warrantyNote: string;
  note: string;
  photo: File | null;
};

function draftFrom(tyre: Tyre | null): TyreDraft {
  return {
    tyreNumber: tyre?.tyreNumber ?? "",
    brand: tyre?.brand ?? "",
    size: tyre?.size ?? "",
    boughtAs: tyre?.boughtAs ?? "new",
    purchaseDate: tyre?.purchaseDate ?? todayInIst(),
    price: tyre?.purchasePriceInr != null ? String(tyre.purchasePriceInr) : "",
    vendor: tyre?.vendor ?? "",
    warrantyMonths: tyre?.warrantyMonths != null ? String(tyre.warrantyMonths) : "",
    warrantyKm: tyre?.warrantyKm != null ? String(tyre.warrantyKm) : "",
    warrantyNote: tyre?.warrantyNote ?? "",
    note: tyre?.note ?? "",
    photo: null,
  };
}

/** New tyre, or edit one. A new tyre can be fitted to a bus straight away. */
export function TyreForm({
  supabase,
  organizationId,
  tyre,
  tyres,
  buses,
  odometers,
  onDone,
  onCancel,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  tyre: Tyre | null;
  tyres: Tyre[];
  buses: BusOption[];
  odometers: Map<string, number>;
  onDone: (tyreId: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<TyreDraft>(() => draftFrom(tyre));
  const [fitNow, setFitNow] = useState(false);
  const [busId, setBusId] = useState("");
  const [position, setPosition] = useState("");
  const [odometer, setOdometer] = useState("");
  const [fitDate, setFitDate] = useState(todayInIst());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<TyreDraft>) => setDraft((current) => ({ ...current, ...patch }));

  async function save() {
    if (!draft.tyreNumber.trim()) return setError("Enter the tyre number.");
    if (!draft.purchaseDate) return setError("Enter the purchase date.");
    const price = optionalNumber(draft.price);
    const months = optionalNumber(draft.warrantyMonths);
    const km = optionalNumber(draft.warrantyKm);
    const odo = optionalNumber(odometer);
    if (!price.ok) return setError("Enter the price in rupees.");
    if (!months.ok || months.value === 0) return setError("Enter the warranty in months, or leave it empty.");
    if (!km.ok || km.value === 0) return setError("Enter the warranty km, or leave it empty.");
    if (fitNow) {
      if (!busId) return setError("Pick the bus.");
      if (!position) return setError("Pick the wheel position.");
      if (odo.value == null) return setError("Enter the odometer reading.");
      if (fitDate < draft.purchaseDate) return setError("The fitting date is before the purchase date.");
    }
    setSaving(true);
    setError("");
    try {
      let billPhotoPath = tyre?.billPhotoPath ?? "";
      if (draft.photo) {
        const { blob } = await compressReceipt(draft.photo, { maxEdge: 1600, quality: 0.75 });
        billPhotoPath = await uploadTyreBill(supabase, organizationId, blob);
      }
      const input: NewTyre = {
        tyreNumber: draft.tyreNumber,
        brand: draft.brand,
        size: draft.size,
        boughtAs: draft.boughtAs,
        purchaseDate: draft.purchaseDate,
        purchasePriceInr: price.value,
        vendor: draft.vendor,
        billPhotoPath,
        warrantyMonths: months.value,
        warrantyKm: km.value,
        warrantyNote: draft.warrantyNote,
        note: draft.note,
      };
      let id = tyre?.id ?? "";
      if (tyre) {
        await updateTyre(supabase, organizationId, tyre.id, input);
      } else {
        id = await addTyre(supabase, organizationId, input);
        if (fitNow) {
          await moveTyre(supabase, id, {
            kind: "fitted",
            date: fitDate,
            busId,
            position,
            odometerKm: odo.value,
          });
        }
      }
      onDone(id);
    } catch (saveError) {
      const message = messageFromUnknown(saveError);
      setError(/tyres_org_number_key|duplicate/i.test(message) ? "A tyre with this number is already entered." : message);
    } finally {
      setSaving(false);
    }
  }

  const positions = busId ? positionsFor(busId, tyres) : [];

  return (
    <Card title={tyre ? `Edit ${tyre.tyreNumber}` : "New tyre"}>
      <label className={LABEL}>
        Tyre number
        <input
          className={FIELD}
          placeholder="Number moulded on the tyre"
          value={draft.tyreNumber}
          onChange={(event) => set({ tyreNumber: event.target.value })}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          Brand
          <input className={FIELD} placeholder="e.g. MRF, Apollo" value={draft.brand} onChange={(event) => set({ brand: event.target.value })} />
        </label>
        <label className={LABEL}>
          Size / model
          <input className={FIELD} placeholder="e.g. 295/80 R22.5" value={draft.size} onChange={(event) => set({ size: event.target.value })} />
        </label>
        <label className={LABEL}>
          Purchase date
          <input type="date" className={FIELD} value={draft.purchaseDate} onChange={(event) => set({ purchaseDate: event.target.value })} />
        </label>
        <label className={LABEL}>
          Price ₹
          <input inputMode="numeric" className={FIELD} value={draft.price} onChange={(event) => set({ price: event.target.value })} />
        </label>
        <label className={LABEL}>
          Bought as
          <select className={FIELD} value={draft.boughtAs} onChange={(event) => set({ boughtAs: event.target.value as TyreDraft["boughtAs"] })}>
            <option value="new">New</option>
            <option value="retreaded">Already retreaded</option>
          </select>
        </label>
        <label className={LABEL}>
          Shop
          <input className={FIELD} value={draft.vendor} onChange={(event) => set({ vendor: event.target.value })} />
        </label>
      </div>
      <p className="-mb-1 text-[13px] font-extrabold">Warranty</p>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          Months
          <input inputMode="numeric" className={FIELD} placeholder="e.g. 24" value={draft.warrantyMonths} onChange={(event) => set({ warrantyMonths: event.target.value })} />
        </label>
        <label className={LABEL}>
          Or km
          <input inputMode="numeric" className={FIELD} placeholder="e.g. 60000" value={draft.warrantyKm} onChange={(event) => set({ warrantyKm: event.target.value })} />
        </label>
      </div>
      <label className={LABEL}>
        Warranty note (optional)
        <input
          className={FIELD}
          placeholder="e.g. Claim at dealer with bill, pro-rata after 1 year"
          value={draft.warrantyNote}
          onChange={(event) => set({ warrantyNote: event.target.value })}
        />
      </label>
      <label className={LABEL}>
        Bill photo (optional)
        <input
          type="file"
          accept="image/*"
          className="h-12 w-full min-w-0 rounded-2xl bg-canvas px-3 py-3 text-sm"
          onChange={(event) => set({ photo: event.target.files?.[0] ?? null })}
        />
      </label>
      <label className={LABEL}>
        Note (optional)
        <input className={FIELD} value={draft.note} onChange={(event) => set({ note: event.target.value })} />
      </label>

      {!tyre ? (
        <label className="flex items-center gap-3 text-sm font-semibold">
          <input type="checkbox" className="h-5 w-5" checked={fitNow} onChange={(event) => setFitNow(event.target.checked)} />
          Fit it to a bus now
        </label>
      ) : null}
      {fitNow ? (
        <>
          <label className={LABEL}>
            Bus
            <select
              className={FIELD}
              value={busId}
              onChange={(event) => {
                setBusId(event.target.value);
                setPosition("");
                setOdometer(odometers.has(event.target.value) ? String(odometers.get(event.target.value)) : "");
              }}
            >
              <option value="">Pick a bus</option>
              {buses.map((bus) => (
                <option key={bus.id} value={bus.id}>
                  {bus.registrationNumber}
                </option>
              ))}
            </select>
          </label>
          {busId ? (
            <>
              <label className={LABEL}>
                Wheel position
                <select className={FIELD} value={position} onChange={(event) => setPosition(event.target.value)}>
                  <option value="">Pick one</option>
                  {positions.map((id) => {
                    const there = occupant(tyres, busId, id);
                    return (
                      <option key={id} value={id} disabled={!!there}>
                        {positionLabel(id)}
                        {there ? ` (has ${there.tyreNumber})` : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={LABEL}>
                  Fitted on
                  <input type="date" className={FIELD} max={todayInIst()} value={fitDate} onChange={(event) => setFitDate(event.target.value)} />
                </label>
                <label className={LABEL}>
                  Odometer km
                  <input inputMode="numeric" className={FIELD} value={odometer} onChange={(event) => setOdometer(event.target.value)} />
                </label>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {tyre && tyre.purchasePriceInr !== optionalNumber(draft.price).value && tyre.status !== "in_stock" ? (
        <p className="text-xs text-muted">A new price also changes what the first bus was charged.</p>
      ) : null}
      <ErrorText message={error} />
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className={SECONDARY} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={PRIMARY} disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Card>
  );
}
