"use client";

import type { ModuleId } from "@domain/modules/modules";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { CrewDayView } from "./daybook/CrewDayView";
import {
  BusDayGrid,
  DayAlertCards,
  DayCrewSection,
  DayProfitCard,
  DayRecordLock,
  DaySwitcher,
} from "./daybook/DayParts";
import { ActionButtons, EntryPanels } from "./daybook/EntryPanels";
import { EntryList } from "./daybook/EntryList";
import { useDayBook } from "./daybook/useDayBook";
import { useEntryForm } from "./daybook/useEntryForm";
import { useOdometerForm } from "./daybook/useOdometerForm";

/** The day book. Inside a module it shows only that module's buses. */
export function DailyLedger({ module }: { module?: ModuleId } = {}) {
  if (!hasPublicSupabaseEnv()) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-6 text-muted">
        Add <code className="text-sm">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="text-sm">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
        <code className="text-sm">.env.local</code>.
      </p>
    );
  }

  return <DailyLedgerBoard module={module} />;
}

function DailyLedgerBoard({ module }: { module?: ModuleId }) {
  const book = useDayBook(module);
  const form = useEntryForm(book);
  const odo = useOdometerForm(book);

  if (book.crewLocked) {
    return <CrewDayView book={book} form={form} odo={odo} />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        <DaySwitcher book={book} />
        <DayRecordLock book={book} />
        <DayProfitCard book={book} />
        <ActionButtons book={book} form={form} />
        <DayAlertCards book={book} />

        {book.error && !form.sheetOpen ? (
          <p className="rounded-lg bg-surface px-4 py-3 text-sm font-semibold text-money-out lg:hidden">
            {book.error}
          </p>
        ) : null}

        <BusDayGrid book={book} />
        <DayCrewSection book={book} />
        <EntryList book={book} />
      </div>

      <EntryPanels book={book} form={form} />
    </div>
  );
}
