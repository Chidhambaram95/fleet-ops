"use client";

import { useEffect, useMemo, useState } from "react";
import { getActiveMembership } from "@data/auth/session";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { BUS_TYPES, BUS_TYPE_LABELS } from "@domain/companies/types";
import { PERMIT_TYPES, SEAT_LAYOUTS } from "@domain/operations/catalog";
import type { Bus, BusKind, NewBus, SeatLayout } from "@domain/operations/types";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

const inputClass =
  "rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-normal";

type BusForm = {
  registrationNumber: string;
  routeLabel: string;
  busType: BusKind;
  seats: string;
  seatLayout: SeatLayout;
  permitType: string;
  runsWith: string;
};

const EMPTY_FORM: BusForm = {
  registrationNumber: "",
  routeLabel: "",
  busType: "town",
  seats: "",
  seatLayout: "",
  permitType: "",
  runsWith: "",
};

function formFromBus(bus: Bus): BusForm {
  return {
    registrationNumber: bus.registrationNumber,
    routeLabel: bus.routeLabel,
    busType: bus.busType,
    seats: bus.seats ? String(bus.seats) : "",
    seatLayout: bus.seatLayout,
    permitType: bus.permitType,
    runsWith: bus.runsWith,
  };
}

function toNewBus(form: BusForm): NewBus {
  const seats = Number(form.seats);
  return {
    registrationNumber: form.registrationNumber,
    routeLabel: form.routeLabel,
    busType: form.busType,
    seats: Number.isInteger(seats) && seats > 0 ? seats : null,
    seatLayout: form.seatLayout,
    permitType: form.permitType,
    runsWith: form.runsWith,
  };
}

function isComplete(form: BusForm) {
  return (
    Boolean(form.registrationNumber.trim()) &&
    (form.busType !== "town" || Boolean(form.routeLabel.trim()))
  );
}

function BusFields({
  form,
  onChange,
}: {
  form: BusForm;
  onChange: (next: BusForm) => void;
}) {
  const set = <K extends keyof BusForm>(key: K, value: BusForm[K]) =>
    onChange({ ...form, [key]: value });
  return (
    <>
      <input
        value={form.registrationNumber}
        onChange={(event) => set("registrationNumber", event.target.value)}
        placeholder="Registration number"
        aria-label="Registration number"
        className={inputClass}
      />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Bus type
        <select
          value={form.busType}
          onChange={(event) => set("busType", event.target.value as BusKind)}
          className={inputClass}
        >
          {BUS_TYPES.map((type) => (
            <option key={type} value={type}>
              {BUS_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      <input
        value={form.routeLabel}
        onChange={(event) => set("routeLabel", event.target.value)}
        placeholder={form.busType === "town" ? "Route" : "Route (optional)"}
        aria-label="Route"
        className={inputClass}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={form.seats}
          onChange={(event) => set("seats", event.target.value.replace(/\D/g, ""))}
          placeholder="Seats"
          aria-label="Seats"
          inputMode="numeric"
          className={inputClass}
        />
        <select
          value={form.seatLayout}
          onChange={(event) => set("seatLayout", event.target.value as SeatLayout)}
          aria-label="Seater or sleeper"
          className={inputClass}
        >
          <option value="">Seater or sleeper</option>
          {SEAT_LAYOUTS.map((layout) => (
            <option key={layout.id} value={layout.id}>
              {layout.label}
            </option>
          ))}
        </select>
      </div>
      <select
        value={form.permitType}
        onChange={(event) => set("permitType", event.target.value)}
        aria-label="Permit type"
        className={inputClass}
      >
        <option value="">Permit type</option>
        {PERMIT_TYPES.map((permit) => (
          <option key={permit} value={permit}>
            {permit}
          </option>
        ))}
      </select>
      <input
        value={form.runsWith}
        onChange={(event) => set("runsWith", event.target.value)}
        placeholder="Runs with (another bus, optional)"
        aria-label="Runs with"
        className={inputClass}
      />
    </>
  );
}

function messageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function FleetManager() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const repo = useMemo(
    () => createSupabaseOperationsRepository(supabase),
    [supabase],
  );
  const [organizationId, setOrganizationId] = useState("");
  const [buses, setBuses] = useState<Bus[]>([]);
  const [form, setForm] = useState<BusForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState<BusForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const membership = await getActiveMembership(supabase);
        if (cancelled) {
          return;
        }
        setOrganizationId(membership.organizationId);
        const nextBuses = await repo.listBuses(membership.organizationId);
        if (!cancelled) {
          setBuses(nextBuses);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(messageFromUnknown(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [repo, supabase]);

  async function addBus() {
    if (!organizationId) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const created = await repo.createBus(organizationId, toNewBus(form));
      setBuses((current) =>
        [...current, created].sort((left, right) =>
          left.registrationNumber.localeCompare(right.registrationNumber),
        ),
      );
      setForm(EMPTY_FORM);
    } catch (addError) {
      setError(messageFromUnknown(addError));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(bus: Bus) {
    setEditingId(bus.id);
    setEditForm(formFromBus(bus));
    setError("");
  }

  async function saveEdit(id: string) {
    if (!organizationId) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await repo.updateBus(organizationId, id, toNewBus(editForm));
      setBuses((current) =>
        current
          .map((bus) => (bus.id === id ? updated : bus))
          .sort((left, right) =>
            left.registrationNumber.localeCompare(right.registrationNumber),
          ),
      );
      setEditingId("");
    } catch (editError) {
      setError(messageFromUnknown(editError));
    } finally {
      setSaving(false);
    }
  }

  async function deleteBus(id: string, registration: string) {
    if (!organizationId) {
      return;
    }
    if (!window.confirm(`Delete ${registration}? Its cash entries will be removed.`)) {
      return;
    }
    const previous = buses;
    setBuses((current) => current.filter((bus) => bus.id !== id));
    setError("");
    try {
      await repo.deleteBus(organizationId, id);
    } catch (deleteError) {
      setBuses(previous);
      setError(messageFromUnknown(deleteError));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Manage fleet</h1>
        <p className="text-sm text-stone-600">
          Add a vehicle, update its details, or remove it from the organization.
        </p>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <form
        className="flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void addBus();
        }}
      >
        <p className="text-sm font-semibold">Add bus</p>
        <BusFields form={form} onChange={setForm} />
        <button
          type="submit"
          disabled={saving || loading || !isComplete(form)}
          className="rounded-xl bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          Add bus
        </button>
      </form>

      <section className="flex flex-col gap-2">
        {loading ? <p className="text-sm text-stone-600">Loading vehicles…</p> : null}
        {buses.map((bus) => (
          <article
            key={bus.id}
            className="flex flex-col gap-3 rounded-2xl bg-white px-3 py-3 shadow-sm"
          >
            {editingId === bus.id ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveEdit(bus.id);
                }}
              >
                <BusFields form={editForm} onChange={setEditForm} />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={saving || !isComplete(editForm)}
                    className="rounded-xl bg-stone-900 px-3 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-stone-100 px-3 text-sm font-medium text-stone-700"
                    onClick={() => setEditingId("")}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{bus.registrationNumber}</p>
                  <p className="text-sm text-stone-600">
                    {[
                      BUS_TYPE_LABELS[bus.busType],
                      bus.routeLabel,
                      bus.seats
                        ? `${bus.seats} ${bus.seatLayout || "seats"}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {bus.runsWith || bus.permitType ? (
                    <p className="text-xs text-stone-500">
                      {[bus.permitType, bus.runsWith ? `Runs with ${bus.runsWith}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="rounded-xl bg-stone-100 px-3 text-sm font-medium text-stone-800"
                    onClick={() => startEdit(bus)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-stone-100 px-3 text-sm font-medium text-stone-700"
                    onClick={() => void deleteBus(bus.id, bus.registrationNumber)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </article>
        ))}
        {!loading && buses.length === 0 && !error ? (
          <p className="rounded-2xl bg-white px-3 py-4 text-stone-600 shadow-sm">
            No buses yet. Add the first vehicle above.
          </p>
        ) : null}
      </section>
    </div>
  );
}
