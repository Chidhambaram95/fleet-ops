"use client";

import { displayDate, formatInr, shiftDate, todayInIst } from "@domain/operations/totals";
import { DayCrewCard } from "@/components/operations/DayCrewCard";
import { RecordLock } from "@/components/history/RecordLock";
import { canManage } from "@domain/rbac/roles";
import { CalendarIcon } from "@/components/ui/icons";
import type { DayBook } from "./useDayBook";

/** Previous day, date picker, next day, and a way back to today. */
export function DaySwitcher({ book }: { book: DayBook }) {
  const { date, setDate, today } = book;
  const arrow =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-xl font-semibold text-muted hover:bg-subtle disabled:opacity-40";
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        className={arrow}
        onClick={() => setDate((current) => shiftDate(current, -1))}
        aria-label="Previous day"
      >
        ‹
      </button>
      <label className="relative flex h-10 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-4 hover:bg-subtle sm:flex-none">
        <span aria-hidden="true" className="truncate text-sm font-semibold text-ink">
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
        className={arrow}
        onClick={() => setDate((current) => shiftDate(current, 1))}
        disabled={today}
        aria-label="Next day"
      >
        ›
      </button>
      {!today ? (
        <button
          type="button"
          className="h-8 shrink-0 rounded-md px-3 text-sm font-medium text-brand hover:bg-brand-soft"
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

/** The day's money in, money out and profit, in one line. */
export function DaySummaryStrip({ book }: { book: DayBook }) {
  const { date, loading, fleetTotals, today } = book;
  const net = fleetTotals.netInr;
  const figure = "font-semibold tabular-nums";
  return (
    <section
      aria-label={today ? "Today's totals" : `Totals for ${displayDate(date)}`}
      className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-line bg-surface px-4 py-3 text-sm"
    >
      <span className="text-muted">
        Money in <span className={`${figure} text-money-in`}>{loading ? "…" : formatInr(fleetTotals.incomeInr)}</span>
      </span>
      <span className="text-muted">
        Money out <span className={`${figure} text-money-out`}>{loading ? "…" : formatInr(fleetTotals.expenseInr)}</span>
      </span>
      <span className="text-muted">
        {today ? "Profit today" : "Profit"}{" "}
        <span className={`${figure} ${net > 0 ? "text-money-in" : net < 0 ? "text-money-out" : "text-ink"}`}>
          {loading ? "…" : formatInr(net)}
        </span>
      </span>
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

