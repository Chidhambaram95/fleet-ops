"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMileage } from "@data/mileage/repository";
import { mileageSummary, type BusMileageView } from "@domain/mileage/mileage";
import { moduleHref, type ModuleId } from "@domain/modules/modules";
import { shiftDate, todayInIst } from "@domain/operations/totals";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

/** Buses with an open mileage alert in the last 30 days, worst first. */
function useMileageProblems(supabase: SupabaseClient, organizationId: string, module: ModuleId | null, refreshKey = "") {
  const [problems, setProblems] = useState<BusMileageView[]>([]);
  useEffect(() => {
    if (!organizationId || !module) {
      setProblems([]);
      return;
    }
    let cancelled = false;
    const to = todayInIst();
    loadMileage(supabase, organizationId, module)
      .then((data) => {
        if (cancelled) return;
        const summary = mileageSummary({ ...data, from: shiftDate(to, -30), to });
        setProblems(summary.buses.filter((view) => view.status === "alert" || view.status === "warn"));
      })
      // No access or no data yet: nothing to show.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supabase, organizationId, module, refreshKey]);
  return problems;
}

/** Home screen card: buses whose mileage needs a look. Hidden when all are fine. */
export function MileageCard({
  supabase,
  organizationId,
  module,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  module: ModuleId;
}) {
  const problems = useMileageProblems(supabase, organizationId, module);
  if (problems.length === 0) {
    return null;
  }
  return (
    <Link
      href={moduleHref(module, "mileage")}
      className="flex flex-col gap-2 rounded-3xl bg-[#fbe9e5] p-4 text-money-out"
    >
      <span className="flex items-center justify-between gap-2 font-extrabold">
        <span>
          Mileage: {problems.length} {problems.length === 1 ? "bus needs" : "buses need"} a look
        </span>
        <span aria-hidden="true">›</span>
      </span>
      {problems.slice(0, 3).map((view) => (
        <span key={view.bus.id} className="flex justify-between gap-3 text-sm text-ink">
          <span className="shrink-0 font-semibold">{view.bus.registrationNumber}</span>
          <span className="truncate text-right">{view.reason}</span>
        </span>
      ))}
      {problems.length > 3 ? <span className="text-xs">and {problems.length - 3} more</span> : null}
    </Link>
  );
}

/** Header bell: how many buses of this module have open mileage alerts. */
export function MileageBell({ organizationId, module }: { organizationId: string; module: ModuleId | null }) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const pathname = usePathname();
  // Loads once per module, and again on leaving the mileage page, where alerts get checked.
  const problems = useMileageProblems(supabase, organizationId, module, pathname.endsWith("/mileage") ? "on" : "off");
  if (!module) {
    return null;
  }
  const count = problems.length;
  return (
    <Link
      href={moduleHref(module, "mileage")}
      aria-label={count ? `Mileage: ${count} ${count === 1 ? "bus needs" : "buses need"} a look` : "Mileage alerts"}
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-full bg-white md:bg-canvas"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {count ? (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-money-out px-1 text-xs font-bold text-white">
          {count}
        </span>
      ) : null}
    </Link>
  );
}
