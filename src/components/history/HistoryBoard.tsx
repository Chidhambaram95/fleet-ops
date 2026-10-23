"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { listHistory } from "@data/history/repository";
import { changedAtLabel, changedByLabel, changedFields, changeTitle, recordLabel } from "@domain/history/describe";
import type { HistoryRow } from "@domain/history/types";
import { displayDate, todayInIst } from "@domain/operations/totals";
import { friendlyErrorMessage } from "@domain/platform/errors";
import type { UserRole } from "@domain/rbac/roles";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { RecordLock } from "./RecordLock";

const PAGE = 30;

const RECORD_FILTERS = [
  "daily_entries",
  "trips",
  "pump_statements",
  "pump_payments",
  "company_expenses",
  "salary_payments",
  "crew_people",
  "intercity_income",
  "renewals",
  "tour_bookings",
  "tour_payments",
];

function dayOf(row: HistoryRow) {
  const data = row.newData ?? row.oldData ?? {};
  for (const field of ["entry_date", "spent_on", "paid_on", "received_on", "statement_on", "start_date"]) {
    if (typeof data[field] === "string") return data[field] as string;
  }
  return "";
}

/** Every change to money records in the last year, newest first. */
export function HistoryBoard({
  organizationId,
  role,
  busNames,
}: {
  organizationId: string;
  role: UserRole;
  busNames: Record<string, string>;
}) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [table, setTable] = useState("");
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [openDay, setOpenDay] = useState("");

  const load = useCallback(
    async (before?: number) => {
      setLoading(true);
      setError("");
      try {
        const next = await listHistory(supabase, organizationId, { before, limit: PAGE, table: table || undefined });
        setRows((current) => (before ? [...current, ...next] : next));
        setMore(next.length === PAGE);
      } catch (loadError) {
        setError(friendlyErrorMessage(loadError));
      } finally {
        setLoading(false);
      }
    },
    [supabase, organizationId, table],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold">Change history</h1>
        <p className="text-sm text-muted">
          Who added, changed or deleted money records in the last year. Days close on their own after 3
          days; changing a closed day needs a comment, which shows here.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-3xl bg-white p-4">
        <h2 className="font-bold">Open a closed day</h2>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Day
          <input
            type="date"
            value={openDay}
            max={todayInIst()}
            onChange={(event) => setOpenDay(event.target.value)}
            className="h-11 rounded-2xl bg-canvas px-3 text-base font-normal sm:w-56"
          />
        </label>
        {openDay ? (
          <RecordLock supabase={supabase} organizationId={organizationId} target={{ day: openDay }} role={role} />
        ) : (
          <p className="text-sm text-muted">
            Pick a day to see if it is closed. Opening it lets you change its cash entries, pump bills, company
            costs and salaries for 30 minutes.
          </p>
        )}
      </section>

      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        Show
        <select
          value={table}
          onChange={(event) => setTable(event.target.value)}
          className="h-11 rounded-2xl bg-white px-3 text-base font-normal sm:w-64"
        >
          <option value="">All records</option>
          {RECORD_FILTERS.map((item) => (
            <option key={item} value={item}>
              {recordLabel(item)}
            </option>
          ))}
        </select>
      </label>

      {error ? <p className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-money-out">{error}</p> : null}

      {rows.length === 0 && !loading && !error ? (
        <p className="rounded-3xl bg-white px-4 py-6 text-muted">No changes yet.</p>
      ) : (
        <ol className="flex flex-col rounded-3xl bg-white px-4 py-1">
          {rows.map((row, index) => {
            const fields = changedFields(row);
            const day = dayOf(row);
            const bus = row.busId ? busNames[row.busId] : "";
            return (
              <li key={row.id} className={`flex flex-col gap-1 py-3 ${index ? "border-t border-line" : ""}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="font-semibold">{changeTitle(row)}</p>
                  <p className="text-xs text-muted">{changedAtLabel(row.changedAt)}</p>
                </div>
                <p className="text-xs text-muted">
                  By {changedByLabel(row)}
                  {bus ? ` · ${bus}` : ""}
                  {day ? ` · for ${displayDate(day)}` : ""}
                </p>
                {fields.length ? (
                  <ul className="text-xs text-ink">
                    {fields.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}
                {row.reason ? (
                  <p className="rounded-xl bg-[#FFF4E0] px-2.5 py-1.5 text-xs text-[#7A4B00]">
                    Comment: {row.reason}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {loading ? <p className="text-sm text-muted">Loading…</p> : null}
      {more && !loading ? (
        <button
          type="button"
          onClick={() => void load(rows[rows.length - 1]?.id)}
          className="min-h-11 self-center rounded-full bg-white px-5 text-sm font-bold text-brand"
        >
          Show older changes
        </button>
      ) : null}
    </div>
  );
}
