"use client";

import { useEffect, useMemo, useState } from "react";
import { getActiveMembership } from "@data/auth/session";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import type { Bus } from "@domain/operations/types";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

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
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [routeLabel, setRouteLabel] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editRegistration, setEditRegistration] = useState("");
  const [editRoute, setEditRoute] = useState("");
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
      const created = await repo.createBus(organizationId, {
        registrationNumber,
        routeLabel,
      });
      setBuses((current) =>
        [...current, created].sort((left, right) =>
          left.registrationNumber.localeCompare(right.registrationNumber),
        ),
      );
      setRegistrationNumber("");
      setRouteLabel("");
    } catch (addError) {
      setError(messageFromUnknown(addError));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(bus: Bus) {
    setEditingId(bus.id);
    setEditRegistration(bus.registrationNumber);
    setEditRoute(bus.routeLabel);
    setError("");
  }

  async function saveEdit(id: string) {
    if (!organizationId) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await repo.updateBus(organizationId, id, {
        registrationNumber: editRegistration,
        routeLabel: editRoute,
      });
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
        <input
          value={registrationNumber}
          onChange={(event) => setRegistrationNumber(event.target.value)}
          placeholder="Registration number"
          aria-label="Registration number"
          className="rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-normal"
        />
        <input
          value={routeLabel}
          onChange={(event) => setRouteLabel(event.target.value)}
          placeholder="Route"
          aria-label="Route"
          className="rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-normal"
        />
        <button
          type="submit"
          disabled={saving || loading || !registrationNumber.trim() || !routeLabel.trim()}
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
                <input
                  value={editRegistration}
                  onChange={(event) => setEditRegistration(event.target.value)}
                  aria-label="Registration number"
                  className="rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-normal"
                />
                <input
                  value={editRoute}
                  onChange={(event) => setEditRoute(event.target.value)}
                  aria-label="Route"
                  className="rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-normal"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={saving || !editRegistration.trim() || !editRoute.trim()}
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
                  <p className="text-sm text-stone-600">{bus.routeLabel}</p>
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
