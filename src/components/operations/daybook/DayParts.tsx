"use client";

import { displayDate, formatInr, shiftDate, todayInIst } from "@domain/operations/totals";
import { MileageCard } from "@/components/mileage/MileageAlerts";
import { BestWorstCard } from "@/components/reports/BestWorstCard";
import { EmiDueCard } from "@/components/renewals/EmiDueCard";
import { RenewalsDueCard } from "@/components/renewals/RenewalsDueCard";
import { DayCrewCard } from "@/components/operations/DayCrewCard";
import { RecordLock } from "@/components/history/RecordLock";
import { canManage } from "@domain/rbac/roles";
import { CalendarIcon } from "@/components/ui/icons";
import type { DayBook } from "./useDayBook";

/** Previous day, date picker, next day, and a way back to today. */
export function DaySwitcher({ book }: { book: DayBook }) {
  const { date, setDate, today } = book;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-xl font-semibold text-muted"
        onClick={() => setDate((current) => shiftDate(current, -1))}
        aria-label="Previous day"
      >
        ‹
      </button>
      <label className="relative flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-4 sm:flex-none">
        <span aria-hidden="true" className="truncate text-[15px] font-bold">
          {today ? `Today, ${displayDate(date)}` : displayDate(date)}
        </span>
        <CalendarIcon />
        <input
          type="date"
          value={date}
          max={todayInIst()}
          onChange={(event) => {
            if (event.target.value) {
              setDate(event.target.value);
            }
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Pick a date"
        />
      </label>
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-xl font-semibold text-muted disabled:opacity-40"
        onClick={() => setDate((current) => shiftDate(current, 1))}
        disabled={today}
        aria-label="Next day"
      >
        ›
      </button>
      {!today ? (
        <button
          type="button"
          className="shrink-0 px-2 text-sm font-bold text-brand"
          onClick={() => setDate(todayInIst())}
        >
          Today
        </button>
      ) : null}
    </div>
  );
}

/** Shows when the day is closed, and lets an admin or manager open or close it. */
export function DayRecordLock({ book }: { book: DayBook }) {
  const { organizationId, role, supabase, date, setDayLocked } = book;
  return organizationId ? (
      <RecordLock
        supabase={supabase}
        organizationId={organizationId}
        target={{ day: date }}
        role={role}
        onLockedChange={setDayLocked}
      />
    ) : null;
}

/** The day's profit with money in and money out. */
export function DayProfitCard({ book }: { book: DayBook }) {
  const { date, loading, fleetTotals, today } = book;
  return (
    <section className="flex flex-col gap-3.5 rounded-3xl bg-brand p-5 text-white">
      <span className="text-[13px] font-semibold text-brand-pale">
        {today ? "Profit today" : `Profit on ${displayDate(date)}`}
      </span>
      <span className="text-[38px] font-extrabold leading-none tracking-tight">
        {loading ? "…" : formatInr(fleetTotals.netInr)}
      </span>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-2xl bg-brand-mid px-3 py-2.5">
          <div className="text-xs text-brand-pale">Money in</div>
          <div className="text-[17px] font-bold">
            {formatInr(fleetTotals.incomeInr)}
          </div>
        </div>
        <div className="rounded-2xl bg-brand-mid px-3 py-2.5">
          <div className="text-xs text-brand-pale">Money out</div>
          <div className="text-[17px] font-bold">
            {formatInr(fleetTotals.expenseInr)}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Alert cards for this module: EMIs, best and worst bus, documents due, mileage. */
export function DayAlertCards({ book }: { book: DayBook }) {
  const { organizationId, role, supabase, module } = book;
  return (
    <>
      {organizationId && module && canManage(role) ? (
        <EmiDueCard supabase={supabase} organizationId={organizationId} module={module} />
      ) : null}

      {organizationId && module && canManage(role) ? (
        <BestWorstCard supabase={supabase} organizationId={organizationId} module={module} />
      ) : null}

      {organizationId && role ? (
        <RenewalsDueCard supabase={supabase} organizationId={organizationId} module={module} />
      ) : null}

      {organizationId && module && canManage(role) ? (
        <MileageCard supabase={supabase} organizationId={organizationId} module={module} />
      ) : null}
    </>
  );
}

/** One tile per bus with its profit for the day and its last odometer reading. */
export function BusDayGrid({ book }: { book: DayBook }) {
  const { loading, error, odometers, busTotals, crewLocked, visibleBuses } = book;
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="font-bold">Buses</h2>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {visibleBuses.map((bus) => {
          const net = busTotals.get(bus.id)?.netInr ?? 0;
          return (
            <div
              key={bus.id}
              className="flex min-w-0 flex-col gap-1 rounded-[20px] bg-white p-3.5"
            >
              <span className="truncate text-xs text-muted">
                {bus.routeLabel || "No route"}
              </span>
              <span className="truncate text-sm font-bold">
                {bus.registrationNumber}
              </span>
              <span
                className={`text-lg font-extrabold ${
                  net > 0 ? "text-money-in" : net < 0 ? "text-money-out" : "text-ink"
                }`}
              >
                {formatInr(net)}
              </span>
              {odometers.has(bus.id) ? (
                <span className="truncate text-xs text-muted">
                  Odometer {odometers.get(bus.id)?.toLocaleString("en-IN")} km
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {loading ? (
        <p className="text-sm text-muted">Loading your buses…</p>
      ) : null}
      {!loading && visibleBuses.length === 0 && !error ? (
        <p className="rounded-[20px] bg-white px-4 py-4 text-muted">
          {crewLocked
            ? "No bus is given to you yet. Ask your admin."
            : "No buses yet."}
        </p>
      ) : null}
    </section>
  );
}

/** Town only: who is on duty on each bus today. */
export function DayCrewSection({ book }: { book: DayBook }) {
  const { organizationId, role, supabase, date, entries, visibleBuses, canWrite, module } = book;
  return module === "town" && organizationId && canManage(role) && visibleBuses.length ? (
      <DayCrewCard
        supabase={supabase}
        organizationId={organizationId}
        day={date}
        buses={visibleBuses}
        busesWithEntries={new Set(entries.map((entry) => entry.busId))}
        canWrite={canWrite}
      />
    ) : null;
}

