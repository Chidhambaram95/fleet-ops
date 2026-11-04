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
import { emiHref, useEmiAlerts } from "@/components/renewals/EmiDueCard";

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
  const [open, setOpen] = useState(false);
  // Loads once per module, and again on leaving the mileage page, where alerts get checked.
  const problems = useMileageProblems(supabase, organizationId, module, pathname.endsWith("/mileage") ? "on" : "off");
  // Again on each page change, so marking an EMI paid clears the bell.
  const emis = useEmiAlerts(supabase, organizationId, module, pathname);
  useEffect(() => setOpen(false), [pathname]);
  if (!module) {
    return null;
  }
  const count = problems.length + emis.length;
  const label = count
    ? [
        problems.length ? `Mileage: ${problems.length} ${problems.length === 1 ? "bus needs" : "buses need"} a look` : "",
        emis.length ? `EMIs: ${emis.length} to look at` : "",
      ]
        .filter(Boolean)
        .join(". ")
    : "Alerts";
  const bell = (
    <>
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
    </>
  );
  const bellClass = "relative inline-flex h-11 w-11 items-center justify-center rounded-full bg-white md:bg-canvas";
  // Only mileage (or nothing): the bell goes straight to the mileage page, as before.
  if (!emis.length) {
    return (
      <Link href={moduleHref(module, "mileage")} aria-label={label} className={bellClass}>
        {bell}
      </Link>
    );
  }
  return (
    <div className="relative">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((value) => !value)} className={bellClass}>
        {bell}
      </button>
      {open ? (
        <div className="absolute right-0 top-12 z-50 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-2xl bg-white p-2 shadow-lg ring-1 ring-line">
          <Link href={emiHref(module)} className="flex flex-col gap-1 rounded-xl px-3 py-2 hover:bg-canvas">
            <span className="text-sm font-extrabold">EMIs · {emis.length}</span>
            {emis.slice(0, 2).map((line, index) => (
              <span key={index} className={`text-xs ${line.kind === "overdue" ? "font-bold text-money-out" : "text-muted"}`}>
                {line.text}
              </span>
            ))}
          </Link>
          <Link href={moduleHref(module, "mileage")} className="flex flex-col gap-1 rounded-xl px-3 py-2 hover:bg-canvas">
            <span className="text-sm font-extrabold">Mileage · {problems.length}</span>
            <span className="text-xs text-muted">
              {problems.length ? `${problems.length} ${problems.length === 1 ? "bus needs" : "buses need"} a look` : "All buses look fine"}
            </span>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
