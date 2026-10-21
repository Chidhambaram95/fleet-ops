"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { listTrips } from "@data/trips/repository";
import { moduleHref, type ModuleId } from "@domain/modules/modules";
import { formatInr } from "@domain/operations/totals";
import type { Bus } from "@domain/operations/types";
import { settlementText } from "@domain/trips/checks";
import type { TripSummary } from "@domain/trips/types";
import { tripDateTime } from "@domain/trips/whatsapp";
import { useOrg } from "@/components/billing/OrgContext";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { StatusBadge } from "./TripEditor";

type Filter = "draft" | "approved";

export function TripsList({ organizationId, module }: { organizationId: string; module: ModuleId }) {
  const org = useOrg();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [filter, setFilter] = useState<Filter>("draft");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [nextTrips, nextBuses] = await Promise.all([
          listTrips(supabase, organizationId),
          createSupabaseOperationsRepository(supabase).listBuses(organizationId),
        ]);
        if (cancelled) return;
        const moduleBuses = nextBuses.filter((bus) => bus.busType === module);
        const ids = new Set(moduleBuses.map((bus) => bus.id));
        const moduleTrips = nextTrips.filter((trip) => ids.has(trip.busId));
        setTrips(moduleTrips);
        setBuses(moduleBuses);
        if (!moduleTrips.some((trip) => trip.status === "draft") && moduleTrips.length > 0) {
          setFilter("approved");
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load trips.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase, organizationId, module]);

  const drafts = trips.filter((trip) => trip.status === "draft");
  const shown = trips.filter((trip) => trip.status === filter);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Trips</h1>
          <p className="text-sm text-muted">One trip sheet is one round trip.</p>
        </div>
        {!org.viewOnly ? (
          <Link
            href={`${moduleHref(module, "trips")}/new`}
            className="flex min-h-12 items-center gap-2 rounded-2xl bg-brand px-5 text-[15px] font-bold text-white"
          >
            <span aria-hidden="true" className="text-xl leading-none">+</span>
            New trip sheet
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-2 rounded-full bg-white p-1">
        {(["draft", "approved"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`h-11 rounded-full text-sm font-bold ${
              filter === value ? "bg-brand text-white" : "text-muted"
            }`}
          >
            {value === "draft" ? `To approve${drafts.length ? ` (${drafts.length})` : ""}` : "Approved"}
          </button>
        ))}
      </div>

      {error ? <p className="text-sm font-semibold text-money-out">{error}</p> : null}
      {loading ? <p className="text-sm text-muted">Loading trips…</p> : null}

      {!loading && shown.length === 0 && !error ? (
        <p className="rounded-3xl bg-white px-4 py-6 text-center text-muted">
          {filter === "draft"
            ? "Nothing to approve. Tap “New trip sheet” when a bus comes back."
            : "No approved trips yet."}
        </p>
      ) : null}

      <div className="flex flex-col gap-2.5">
        {shown.map((trip) => {
          const bus = buses.find((item) => item.id === trip.busId);
          const km =
            trip.startKm != null && trip.endKm != null ? trip.endKm - trip.startKm : null;
          return (
            <Link
              key={trip.id}
              href={`${moduleHref(module, "trips")}/${trip.id}`}
              className="flex flex-col gap-2 rounded-3xl bg-white p-4 hover:bg-white/80"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-extrabold">
                    {bus?.registrationNumber ?? "Bus removed"}
                    {trip.sheetNo ? (
                      <span className="font-semibold text-muted"> · Sheet {trip.sheetNo}</span>
                    ) : null}
                  </p>
                  <p className="truncate text-sm text-muted">{trip.route || "No route written"}</p>
                </div>
                <StatusBadge approved={trip.status === "approved"} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                {trip.startedAt ? <span>{tripDateTime(trip.startedAt)}</span> : null}
                {km != null ? <span>{km.toLocaleString("en-IN")} km</span> : null}
                {trip.dieselLitres ? (
                  <span>
                    {trip.dieselLitres.toLocaleString("en-IN")} L diesel
                    {km ? ` · ${(km / trip.dieselLitres).toFixed(1)} km/L` : ""}
                  </span>
                ) : null}
                <span>Spent {formatInr(trip.cashSpentInr)}</span>
              </div>
              <p className="text-sm font-bold text-brand">
                {settlementText(trip.cashSpentInr - trip.advanceInr)}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
