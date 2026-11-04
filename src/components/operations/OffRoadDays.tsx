"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  OFF_ROAD_REASONS,
  addOffRoadDay,
  listOffRoadDays,
  removeOffRoadDay,
  type OffRoadDay,
  type OffRoadReason,
} from "@data/operations/offRoad";
import { shiftDate, todayInIst } from "@domain/operations/totals";
import type { Bus } from "@domain/operations/types";
import { friendlyErrorMessage } from "@domain/platform/errors";
import { shortDay } from "@/components/ui/kit";

const inputClass = "h-12 rounded-2xl bg-canvas px-4 text-base font-normal";
const REASON_LABELS = new Map(OFF_ROAD_REASONS.map((item) => [item.id, item.label]));

/**
 * Days a bus stood off the road (breakdown, FC, no crew). Those days don't
 * count as run in the reports or in splitting crew salaries.
 */
export function OffRoadDays({
  supabase,
  organizationId,
  buses,
  canEdit,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  buses: Bus[];
  canEdit: boolean;
}) {
  const today = todayInIst();
  const [days, setDays] = useState<OffRoadDay[]>([]);
  const [busId, setBusId] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState<OffRoadReason>("breakdown");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    listOffRoadDays(supabase, organizationId, { from: shiftDate(today, -60), to: shiftDate(today, 30) })
      .then((rows) => {
        if (!cancelled) setDays(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supabase, organizationId, today]);

  const names = new Map(buses.map((bus) => [bus.id, bus.registrationNumber]));
  const shown = days.filter((day) => names.has(day.busId));
  const chosenBus = busId || buses[0]?.id || "";

  async function save() {
    if (!chosenBus || !from) return;
    const last = to && to >= from ? to : from;
    const dates: string[] = [];
    for (let day = from; day <= last && dates.length < 62; day = shiftDate(day, 1)) dates.push(day);
    const taken = new Set(days.filter((day) => day.busId === chosenBus).map((day) => day.date));
    setSaving(true);
    setError("");
    try {
      for (const date of dates) {
        if (taken.has(date)) continue;
        await addOffRoadDay(supabase, organizationId, { busId: chosenBus, date, reason, note: note.trim() });
      }
      setNote("");
      setDays(
        await listOffRoadDays(supabase, organizationId, { from: shiftDate(today, -60), to: shiftDate(today, 30) }),
      );
    } catch (saveError) {
      setError(friendlyErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const previous = days;
    setDays((current) => current.filter((day) => day.id !== id));
    setError("");
    try {
      await removeOffRoadDay(supabase, organizationId, id);
    } catch (removeError) {
      setDays(previous);
      setError(friendlyErrorMessage(removeError));
    }
  }

  if (!buses.length) return null;

  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-white p-4 md:p-5">
      <div>
        <h2 className="font-bold">Days off the road</h2>
        <p className="text-sm text-muted">
          Mark days a bus stood for a breakdown, FC or no crew. Reports show them as days not run, even if a bill
          was entered that day.
        </p>
      </div>
      {error ? <p className="text-sm text-money-out">{error}</p> : null}
      {canEdit ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <select value={chosenBus} onChange={(event) => setBusId(event.target.value)} aria-label="Bus" className={inputClass}>
            {buses.map((bus) => (
              <option key={bus.id} value={bus.id}>
                {bus.registrationNumber}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              From
              <input
                type="date"
                value={from}
                max={shiftDate(today, 30)}
                onChange={(event) => {
                  setFrom(event.target.value);
                  if (to < event.target.value) setTo(event.target.value);
                }}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              To
              <input
                type="date"
                value={to}
                min={from}
                max={shiftDate(today, 30)}
                onChange={(event) => setTo(event.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value as OffRoadReason)}
            aria-label="Reason"
            className={inputClass}
          >
            {OFF_ROAD_REASONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Note (optional)"
            aria-label="Note"
            className={inputClass}
          />
          <button
            type="submit"
            disabled={saving || !from}
            className="h-12 rounded-2xl bg-brand px-4 text-[15px] font-bold text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Mark off road"}
          </button>
        </form>
      ) : null}
      {shown.length ? (
        <ul className="flex flex-col gap-1">
          {shown.map((day) => (
            <li key={day.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                <span className="font-semibold">{names.get(day.busId)}</span> · {shortDay(day.date)} ·{" "}
                {REASON_LABELS.get(day.reason)}
                {day.note ? <span className="text-muted"> · {day.note}</span> : null}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => void remove(day.id)}
                  className="shrink-0 text-sm font-bold text-brand"
                  aria-label={`Remove ${names.get(day.busId)} ${day.date}`}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No days marked in the last two months.</p>
      )}
    </section>
  );
}
