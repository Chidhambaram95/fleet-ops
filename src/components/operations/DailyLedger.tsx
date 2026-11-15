"use client";

import type { ModuleId } from "@domain/modules/modules";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { useState } from "react";
import { CrewDayView } from "./daybook/CrewDayView";
import { DayCrewSection, DayRecordLock, DaySummaryStrip, DaySwitcher } from "./daybook/DayParts";
import { ActionButtons, EntryPanels } from "./daybook/EntryPanels";
import { DaySendPanel, EntryList } from "./daybook/EntryList";
import { useDayBook } from "./daybook/useDayBook";
import { useEntryForm } from "./daybook/useEntryForm";
import { useOdometerForm } from "./daybook/useOdometerForm";
import { ErrorText, PageHeader, Tabs } from "@/components/ui/primitives";

type DayTab = "entries" | "crew" | "send";

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
  const [tab, setTab] = useState<DayTab>("entries");

  if (book.crewLocked) {
    return <CrewDayView book={book} form={form} odo={odo} />;
  }

  // Who is on duty is a Town screen; the other modules take crew from the trip sheet.
  const tabs: { id: DayTab; label: string }[] = [
    { id: "entries", label: "Entries" },
    ...(module === "town" ? [{ id: "crew" as const, label: "Crew on duty" }] : []),
    { id: "send", label: "Close & send" },
  ];
  const active = tabs.some((item) => item.id === tab) ? tab : "entries";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        <PageHeader title="Day book" hint="Money in and out, day by day" action={<DaySwitcher book={book} />} />
        <DayRecordLock book={book} />
        <DaySummaryStrip book={book} />
        <ActionButtons book={book} form={form} />
        {!form.sheetOpen ? <ErrorText message={book.error} /> : null}
        <Tabs value={active} options={tabs} onChange={setTab} />
        <div role="tabpanel" className="flex flex-col gap-4">
          {active === "entries" ? <EntryList book={book} /> : null}
          {active === "crew" ? <DayCrewSection book={book} /> : null}
          {active === "send" ? <DaySendPanel book={book} /> : null}
        </div>
      </div>

      <EntryPanels book={book} form={form} />
    </div>
  );
}
