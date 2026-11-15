"use client";

import { displayDate, todayInIst } from "@domain/operations/totals";
import type { DayBook } from "./useDayBook";
import type { EntryFormState } from "./useEntryForm";
import type { OdometerFormState } from "./useOdometerForm";
import { DayRecordLock } from "./DayParts";
import { ActionButtons, EntryPanels } from "./EntryPanels";
import { FIELD } from "./styles";

/** What a crew member sees: their bus, the add-entry buttons, the odometer, and the last thing they saved. */
export function CrewDayView({ book, form, odo }: { book: DayBook; form: EntryFormState; odo: OdometerFormState }) {
  const { org, loading, error, lastSaved, visibleBuses } = book;
  const { sheetOpen } = form;
  const { odometerKm, setOdometerKm, odometerSaving, odometerError, saveOdometer } = odo;
  const myBus = visibleBuses[0];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="flex flex-col gap-1 rounded-3xl bg-brand p-5 text-white">
          <span className="text-[13px] font-semibold text-brand-pale">
            Your bus · Today, {displayDate(todayInIst())}
          </span>
          <span className="text-2xl font-extrabold tracking-tight">
            {myBus ? myBus.registrationNumber : loading ? "…" : "No bus yet"}
          </span>
          {myBus?.routeLabel ? (
            <span className="text-sm text-brand-pale">{myBus.routeLabel}</span>
          ) : null}
        </section>

        <DayRecordLock book={book} />

        {!loading && !myBus && !error ? (
          <p className="rounded-[20px] bg-white px-4 py-4 text-muted">
            No bus is given to you yet. Ask your admin.
          </p>
        ) : null}

        {myBus ? <ActionButtons book={book} form={form} /> : null}

        {lastSaved ? (
          <p
            role="status"
            className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-money-in"
          >
            {lastSaved}
          </p>
        ) : null}

        {error && !sheetOpen ? (
          <p className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-money-out lg:hidden">
            {error}
          </p>
        ) : null}

        {myBus ? (
          <form
            className="flex flex-col gap-3 rounded-3xl bg-white p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void saveOdometer();
            }}
          >
            <h2 className="font-bold">Odometer</h2>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              Odometer reading (km)
              <input
                inputMode="numeric"
                pattern="[0-9 ,]*"
                value={odometerKm}
                onChange={(event) => setOdometerKm(event.target.value)}
                placeholder="Read it off the bus"
                className={FIELD}
              />
            </label>
            {odometerError ? (
              <p className="text-sm font-semibold text-money-out">{odometerError}</p>
            ) : null}
            <button
              type="submit"
              disabled={odometerSaving || org.viewOnly}
              className="h-12 rounded-2xl bg-brand px-4 text-base font-bold text-white disabled:opacity-50"
            >
              {org.viewOnly
                ? "View only until payment is received"
                : odometerSaving
                  ? "Saving…"
                  : "Save odometer"}
            </button>
          </form>
        ) : null}
      </div>

      {myBus ? <EntryPanels book={book} form={form} /> : null}
    </div>
  );
}

