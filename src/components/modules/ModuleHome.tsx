"use client";

import Link from "next/link";
import { useMemo } from "react";
import { listIntercityIncome, listPumpPayments, listPumpStatements } from "@data/money/repository";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { listTripsWithLines } from "@data/trips/repository";
import { pumpBalances } from "@domain/money/fuel";
import { hasScreen, MODULE_TITLES, moduleHref, type ModuleId } from "@domain/modules/modules";
import { formatInr, todayInIst } from "@domain/operations/totals";
import { tripTotals } from "@domain/trips/checks";
import { useOrg } from "@/components/billing/OrgContext";
import { NeedsAttention } from "@/components/overview/NeedsAttention";
import { BestWorstCard } from "@/components/reports/BestWorstCard";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { Empty, ErrorText, KpiTile, PageHeader, PRIMARY, useLoaded } from "@/components/ui/kit";

/** Home of a trip module (Omni, Tour): what needs doing today. */
export function ModuleHome({ organizationId, module }: { organizationId: string; module: ModuleId }) {
  const org = useOrg();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const monthStart = `${todayInIst().slice(0, 7)}-01`;
  const withIntercity = hasScreen(module, "intercity");
  const { data, loading, error } = useLoaded(
    async () => {
      const [allTrips, allBuses, payments, statements, intercity] = await Promise.all([
        listTripsWithLines(supabase, organizationId, { limit: 2000 }),
        createSupabaseOperationsRepository(supabase).listBuses(organizationId),
        listPumpPayments(supabase, organizationId),
        listPumpStatements(supabase, organizationId),
        withIntercity
          ? listIntercityIncome(supabase, organizationId, { from: monthStart, to: todayInIst() })
          : Promise.resolve([]),
      ]);
      const buses = allBuses.filter((bus) => bus.busType === module);
      const ids = new Set(buses.map((bus) => bus.id));
      const trips = allTrips.filter((trip) => ids.has(trip.busId));
      const approved = trips.filter((trip) => trip.status === "approved");
      const open = approved
        .filter((trip) => !trip.settledOn)
        .map((trip) => tripTotals(trip).balanceInr);
      const pumps = pumpBalances(
        approved,
        payments.filter((item) => item.module === module),
        statements.filter((item) => item.module === module),
      );
      return {
        buses: buses.length,
        toApprove: trips.filter((trip) => trip.status === "draft").length,
        owedToDrivers: open.filter((value) => value > 0).reduce((total, value) => total + value, 0),
        owedByDrivers: open.filter((value) => value < 0).reduce((total, value) => total - value, 0),
        pumpOutstanding: pumps.reduce((total, pump) => total + Math.max(pump.expectedInr, 0), 0),
        pumpCount: pumps.filter((pump) => pump.expectedInr > 0).length,
        intercityInr: intercity
          .filter((item) => item.busIds.some((id) => ids.has(id)))
          .reduce((total, item) => total + item.amountInr, 0),
      };
    },
    {
      buses: 0,
      toApprove: 0,
      owedToDrivers: 0,
      owedByDrivers: 0,
      pumpOutstanding: 0,
      pumpCount: 0,
      intercityInr: 0,
    },
    module,
  );

  const trips = moduleHref(module, "trips");
  const tiles: { href: string; label: string; value: string; detail: string; tone?: "in" | "out" }[] = [
    {
      href: trips,
      label: "Trips to approve",
      value: String(data.toApprove),
      detail: data.toApprove ? "Check and approve the trip sheets" : "All trip sheets approved",
    },
    {
      href: moduleHref(module, "crew"),
      label: "Advances to settle",
      value: formatInr(data.owedToDrivers),
      detail: data.owedByDrivers ? `Drivers owe ${formatInr(data.owedByDrivers)}` : "Unsettled trip advances",
      tone: data.owedToDrivers ? "out" : undefined,
    },
    {
      href: moduleHref(module, "fuel"),
      label: "Diesel on credit",
      value: formatInr(data.pumpOutstanding),
      detail: data.pumpCount ? `Owed to ${data.pumpCount} pump${data.pumpCount === 1 ? "" : "s"}` : "Nothing owed",
      tone: data.pumpOutstanding ? "out" : undefined,
    },
  ];
  if (withIntercity) {
    tiles.push({
      href: moduleHref(module, "intercity"),
      label: "Intercity this month",
      value: formatInr(data.intercityInr),
      detail: "Payments received",
      tone: data.intercityInr ? "in" : undefined,
    });
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <PageHeader
        title="Overview"
        hint={`${MODULE_TITLES[module]} · ${loading ? "loading…" : `${data.buses} bus${data.buses === 1 ? "" : "es"}`}`}
        action={
          !org.viewOnly ? (
            <Link href={`${trips}/new`} className={PRIMARY}>
              <span aria-hidden="true" className="text-xl leading-none">+</span>
              New trip sheet
            </Link>
          ) : null
        }
      />
      <ErrorText message={error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {tiles.map((tile) => (
          <KpiTile
            key={tile.label}
            href={tile.href}
            label={tile.label}
            value={loading ? "…" : tile.value}
            detail={tile.detail}
            tone={tile.tone}
          />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <NeedsAttention module={module} />
        <BestWorstCard supabase={supabase} organizationId={organizationId} module={module} />
      </div>
      {!loading && data.buses === 0 ? (
        <Empty>
          No buses in this module yet.{" "}
          <Link href={moduleHref(module, "buses")} className="font-semibold text-brand">
            Add a bus
          </Link>
        </Empty>
      ) : null}
    </div>
  );
}
