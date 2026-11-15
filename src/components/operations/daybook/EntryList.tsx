"use client";

import { categoryLabel } from "@domain/operations/catalog";
import { displayDate, formatInr } from "@domain/operations/totals";
import { LastChangeLine } from "@/components/history/RecordLock";
import { canManage } from "@domain/rbac/roles";
import { DownloadIcon, SendIcon } from "@/components/ui/icons";
import type { DayBook } from "./useDayBook";

/** The day's entries, with Undo for admins and managers, plus WhatsApp and download. */
export function EntryList({ book }: { book: DayBook }) {
  const { organizationId, role, supabase, date, buses, allEntries, entries, loading, today, canUndo, removeEntry, downloadCsv, sendToOperator, module } = book;
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">
          {today ? "Today's entries" : `Entries on ${displayDate(date)}`}
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={sendToOperator}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-bold text-money-in disabled:opacity-40"
          >
            <SendIcon />
            Send daily summary on WhatsApp
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={downloadCsv}
            aria-label="Download as a file"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-bold text-muted disabled:opacity-40"
          >
            <DownloadIcon />
            <span className="hidden sm:inline">Download</span>
          </button>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="rounded-[20px] bg-white px-4 py-4 text-muted">
          Nothing added yet. Add the first ticket money or diesel bill.
        </p>
      ) : (
        <div className="rounded-[20px] bg-white px-4 py-1">
          {entries.map((entry, index) => {
            const bus = buses.find((item) => item.id === entry.busId);
            return (
              <article
                key={entry.id}
                className={`flex items-center justify-between gap-3 py-3 ${
                  index > 0 ? "border-t border-line" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="font-semibold">
                    {categoryLabel(entry.kind, entry.category)}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {bus?.registrationNumber}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span
                    className={`font-bold ${
                      entry.kind === "income" ? "text-money-in" : "text-money-out"
                    }`}
                  >
                    {entry.kind === "income" ? "+" : "−"}
                    {formatInr(entry.amountInr)}
                  </span>
                  {canUndo ? (
                    <button
                      type="button"
                      className="px-2 text-[13px] font-semibold text-muted"
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

