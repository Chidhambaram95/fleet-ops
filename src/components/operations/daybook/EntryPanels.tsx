"use client";

import { CameraIcon, ArrowIcon } from "@/components/ui/icons";
import type { DayBook } from "./useDayBook";
import type { EntryFormState } from "./useEntryForm";
import { ScanInput, EntryForm } from "./EntryForm";

/** Phone only: scan a bill, or start a money in / money out entry. */
export function ActionButtons({ book, form }: { book: DayBook; form: EntryFormState }) {
  const { canWrite } = book;
  const { scanning, openSheet } = form;
  return canWrite ? (
    <div className="flex flex-col gap-2.5 lg:hidden">
      <label className="flex min-h-16 cursor-pointer items-center justify-center gap-3 rounded-xl border border-line bg-surface px-4 text-base font-semibold text-brand shadow-[0_1px_0_rgba(26,27,46,0.04)] active:bg-brand-soft">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-soft">
          <CameraIcon />
        </span>
        {scanning ? "Reading the bill…" : "Scan a bill"}
        <ScanInput book={book} form={form} />
      </label>
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => openSheet("income")}
          className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-sm font-semibold text-money-in"
        >
          <ArrowIcon direction="in" />
          Money in
        </button>
        <button
          type="button"
          onClick={() => openSheet("expense")}
          className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-sm font-semibold text-money-out"
        >
          <ArrowIcon direction="out" />
          Money out
        </button>
      </div>
    </div>
  ) : null;
}

/** The add-entry form: a side panel on laptops, a bottom sheet on phones. */
export function EntryPanels({ book, form }: { book: DayBook; form: EntryFormState }) {
  const { sheetOpen, setSheetOpen } = form;
  return (
    <>
      <aside className="hidden flex-col gap-4 rounded-xl border border-line bg-surface p-5 lg:sticky lg:top-20 lg:flex">
        <h2 className="text-base font-semibold text-ink">Add cash entry</h2>
        <EntryForm book={book} form={form} place="side" />
      </aside>

      {sheetOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-ink/45 lg:hidden">
          <button
            type="button"
            aria-label="Close"
            className="flex-1"
            onClick={() => setSheetOpen(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Add cash entry"
            className="mx-auto flex max-h-[90dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-2xl bg-surface px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Add cash entry</h2>
              <button
                type="button"
                className="px-2 text-sm font-semibold text-brand"
                onClick={() => setSheetOpen(false)}
              >
                Cancel
              </button>
            </div>
            <EntryForm book={book} form={form} place="sheet" />
          </section>
        </div>
      ) : null}
    </>
  );
}

