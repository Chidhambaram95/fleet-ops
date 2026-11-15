"use client";

import { categoryLabel } from "@domain/operations/catalog";
import { displayDate, formatInr } from "@domain/operations/totals";
import { LastChangeLine } from "@/components/history/RecordLock";
import { canManage } from "@domain/rbac/roles";
import { DownloadIcon, SendIcon } from "@/components/ui/icons";
import { Empty } from "@/components/ui/primitives";
import type { DayBook } from "./useDayBook";

/** The day's entries, with Undo for admins and managers. */
export function EntryList({ book }: { book: DayBook }) {
  const { organizationId, role, supabase, date, buses, allEntries, entries, today, canUndo, removeEntry, module } = book;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-ink">
        {today ? "Today's entries" : `Entries on ${displayDate(date)}`}
      </h2>
      {entries.length === 0 ? (
        <Empty>Nothing added yet. Add the first ticket money or diesel bill.</Empty>
      ) : (
        <div className="divide-y divide-line rounded-xl border border-line bg-surface px-4">
          {entries.map((entry) => {
            const bus = buses.find((item) => item.id === entry.busId);
            return (
              <article key={entry.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {categoryLabel(entry.kind, entry.category)}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {bus?.registrationNumber}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      entry.kind === "income" ? "text-money-in" : "text-money-out"
                    }`}
                  >
                    {entry.kind === "income" ? "+" : "−"}
                    {formatInr(entry.amountInr)}
                  </span>
                  {canUndo ? (
                    <button
                      type="button"
                      className="h-8 rounded-md px-2 text-xs font-medium text-muted hover:bg-subtle hover:text-ink"
                      onClick={() => void removeEntry(entry.id)}
                    >
                      Undo
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {organizationId && canManage(role) ? (
        <LastChangeLine
          supabase={supabase}
          organizationId={organizationId}
          target={{ day: date, module }}
          refreshKey={allEntries}
        />
      ) : null}
    </section>
  );
}

/** Send the day's summary to the operator on WhatsApp, or download it. Closing the day is in the bar at the top. */
export function DaySendPanel({ book }: { book: DayBook }) {
  const { date, loading, entries, today, downloadCsv, sendToOperator } = book;
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 lg:p-5">
      <div>
        <h2 className="text-base font-semibold text-ink">
          {today ? "Today's summary" : `Summary for ${displayDate(date)}`}
        </h2>
        <p className="text-sm text-muted">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}. Send the summary once everything is in.
          To close the day, use the bar above.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={sendToOperator}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-whatsapp px-5 text-sm font-semibold text-white disabled:opacity-50 lg:h-10"
        >
          <SendIcon />
          Send on WhatsApp
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={downloadCsv}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-5 text-sm font-semibold text-ink hover:bg-subtle disabled:opacity-50 lg:h-10"
        >
          <DownloadIcon />
          Download
        </button>
      </div>
    </section>
  );
}
