"use client";

import { useEffect, useMemo, useState } from "react";
import { getActiveMembership } from "@data/auth/session";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { BUS_TYPES, BUS_TYPE_LABELS } from "@domain/companies/types";
import { MODULE_TITLES, type ModuleId } from "@domain/modules/modules";
import { PERMIT_TYPES, SEAT_LAYOUTS } from "@domain/operations/catalog";
import type { Bus, BusKind, NewBus, SeatLayout } from "@domain/operations/types";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { useOrg } from "@/components/billing/OrgContext";
import { friendlyErrorMessage } from "@domain/platform/errors";

const inputClass =
  "h-12 rounded-2xl bg-canvas px-4 text-base font-normal";

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
  showType = false,
}: {
  form: BusForm;
  onChange: (next: BusForm) => void;
  /** New buses take their module's type; an existing bus can be moved to another module. */
  showType?: boolean;
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
      {showType ? (
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
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
      ) : null}
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
          aria-label="Seat type"
          className={inputClass}
        >
          <option value="">Seat type</option>
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
        placeholder="Paired bus (optional)"
        aria-label="Paired bus"
        className={inputClass}
      />
    </>
  );
}

function messageFromUnknown(error: unknown) {
  return friendlyErrorMessage(error);
}

export function FleetManager({ canEdit: isAdmin, module }: { canEdit: boolean; module: ModuleId }) {
  const emptyForm: BusForm = { ...EMPTY_FORM, busType: module };
  const { viewOnly } = useOrg();
  const canEdit = isAdmin && !viewOnly;
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const repo = useMemo(
    () => createSupabaseOperationsRepository(supabase),
    [supabase],
  );
  const [organizationId, setOrganizationId] = useState("");
  const [buses, setBuses] = useState<Bus[]>([]);
  const [form, setForm] = useState<BusForm>(emptyForm);
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
          setBuses(nextBuses.filter((bus) => bus.busType === module));
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
  }, [repo, supabase, module]);

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
      setForm(emptyForm);
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
          // A bus moved to another module leaves this list.
          .filter((bus) => bus.busType === module)
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
    if (!window.confirm(`Delete ${registration}? Its cash entries, trip sheets and renewals will be removed too. This cannot be undone.`)) {
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-extrabold">{MODULE_TITLES[module]}</h1>
        <p className="text-sm text-muted">
          {canEdit
            ? "Add a bus, change its details, or remove it."
            : isAdmin
              ? "The app is view-only until the payment is received."
              : "Ask your admin to add or change a bus."}
        </p>
      </div>

      {error ? <p className="text-sm text-money-out">{error}</p> : null}

      {canEdit ? (
        <form
          className="flex flex-col gap-2 rounded-3xl bg-white p-4 md:p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void addBus();
          }}
        >
          <p className="font-bold">Add a bus</p>
          <BusFields form={form} onChange={setForm} />
          <button
            type="submit"
            disabled={saving || loading || !isComplete(form)}
            className="h-12 rounded-2xl bg-brand px-4 text-[15px] font-bold text-white disabled:opacity-60"
          >
            Add bus
          </button>
        </form>
      ) : null}

      <section className="flex flex-col gap-2">
        {loading ? <p className="text-sm text-muted">Loading buses…</p> : null}
        {buses.map((bus) => (
          <article
            key={bus.id}
            className="flex flex-col gap-3 rounded-[20px] bg-white px-4 py-3"
          >
            {editingId === bus.id ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveEdit(bus.id);
                }}
              >
                <BusFields form={editForm} onChange={setEditForm} showType />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={saving || !isComplete(editForm)}
                    className="rounded-2xl bg-brand px-4 text-sm font-bold text-white disabled:opacity-60"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-canvas px-4 text-sm font-semibold text-ink"
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
                  <p className="text-sm text-muted">
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
                    <p className="text-xs text-muted">
                      {[bus.permitType, bus.runsWith ? `Paired with ${bus.runsWith}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className="rounded-full bg-canvas px-4 text-sm font-semibold text-ink"
                      onClick={() => startEdit(bus)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="rounded-full bg-canvas px-4 text-sm font-semibold text-ink"
                      onClick={() => void deleteBus(bus.id, bus.registrationNumber)}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </article>
        ))}
        {!loading && buses.length === 0 && !error ? (
          <p className="rounded-[20px] bg-white px-4 py-4 text-muted">
            {canEdit ? "No buses yet. Add the first one above." : "No buses yet."}
          </p>
        ) : null}
      </section>
    </div>
  );
}
