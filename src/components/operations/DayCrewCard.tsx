"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { useState } from "react";
import { listDayCrew, setDayCrew } from "@data/crew/dayCrew";
import { listCrewPeople } from "@data/money/repository";
import {
  copyFromDay,
  dayCrewMap,
  DUTIES,
  JOB_LABELS,
  missingDuties,
  peopleForDuty,
} from "@domain/crew/dayCrew";
import type { CrewJob } from "@domain/money/types";
import { shiftDate } from "@domain/operations/totals";
import type { Bus } from "@domain/operations/types";
import { Card, ErrorText, messageFromUnknown, useLoaded } from "@/components/ui/kit";

const SELECT = "h-11 w-full min-w-0 rounded-2xl bg-canvas px-3 text-[15px] disabled:opacity-70";

/**
 * Who drove each Town bus that day, and who was conductor and cleaner.
 * Admins and managers fill it in; a bus with money entries needs its driver
 * and conductor before the day can be closed.
 */
export function DayCrewCard({
  supabase,
  organizationId,
  day,
  buses,
  busesWithEntries,
  canWrite,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  day: string;
  buses: Bus[];
  busesWithEntries: ReadonlySet<string>;
  canWrite: boolean;
}) {
  const { data, loading, error, reload } = useLoaded(
    async () => {
      const [people, today, yesterday] = await Promise.all([
        listCrewPeople(supabase, organizationId),
        listDayCrew(supabase, organizationId, day),
        listDayCrew(supabase, organizationId, shiftDate(day, -1)),
      ]);
      return {
        people: people.filter((person) => person.module === "town"),
        today: dayCrewMap(today),
        yesterday: dayCrewMap(yesterday),
      };
    },
    { people: [], today: dayCrewMap([]), yesterday: dayCrewMap([]) },
    `${organizationId}:${day}`,
  );
  const [saving, setSaving] = useState("");
  const [saveError, setSaveError] = useState("");

  async function run(key: string, action: () => Promise<void>) {
    setSaving(key);
    setSaveError("");
    try {
      await action();
    } catch (actionError) {
      setSaveError(messageFromUnknown(actionError));
    } finally {
      setSaving("");
      reload();
    }
  }

  const busIds = buses.map((bus) => bus.id);
  const copies = copyFromDay(data.yesterday, data.today, busIds, data.people);
  const needing = buses.filter((bus) => busesWithEntries.has(bus.id) && missingDuties(data.today, bus.id).length > 0);

  return (
    <Card
      title="Crew on duty"
      action={
        canWrite && copies.length ? (
          <button
            type="button"
            disabled={Boolean(saving)}
            onClick={() =>
              void run("copy", async () => {
                for (const fill of copies) {
                  await setDayCrew(supabase, organizationId, day, fill.busId, fill.duty, fill.personId);
                }
              })
            }
            className="min-h-10 rounded-full bg-brand-soft px-4 text-[13px] font-bold text-brand-dark disabled:opacity-50"
          >
            {saving === "copy" ? "Copying…" : "Same crew as yesterday"}
          </button>
        ) : null
      }
    >
      {needing.length ? (
        <p role="status" className="rounded-2xl bg-[#FFF4E0] px-3 py-2 text-sm font-semibold text-[#7A4B00]">
          {needing.length === 1 ? "1 bus still needs" : `${needing.length} buses still need`} a driver or conductor
          before you can close the day.
        </p>
      ) : null}
      <ErrorText message={error} />
      <ErrorText message={saveError} />
      {!loading && data.people.length === 0 ? (
        <p className="text-sm text-muted">
          Add your drivers and conductors under{" "}
          <Link href="/town/crew" className="font-bold text-brand underline-offset-2 hover:underline">
            Crew → People
          </Link>{" "}
          first.
        </p>
      ) : null}
      <div className="flex flex-col">
        {buses.map((bus, index) => {
          const onBus = data.today.get(bus.id) ?? {};
          const missing = busesWithEntries.has(bus.id) ? missingDuties(data.today, bus.id) : [];
          return (
            <div key={bus.id} className={`flex flex-col gap-2 py-3 ${index > 0 ? "border-t border-line" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-bold">{bus.registrationNumber}</span>
                {missing.length ? (
                  <span className="text-xs font-bold text-money-out">
                    {missing.length === 2 ? "Driver and conductor needed" : `${JOB_LABELS[missing[0]]} needed`}
                  </span>
                ) : (
                  <span className="truncate text-xs text-muted">{bus.routeLabel}</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {DUTIES.map((duty) => (
                  <DutySelect
                    key={duty}
                    duty={duty}
                    value={onBus[duty] ?? ""}
                    people={data.people}
                    needed={missing.includes(duty)}
                    disabled={!canWrite || loading || Boolean(saving)}
                    onChange={(personId) =>
                      void run(`${bus.id}:${duty}`, () =>
                        setDayCrew(supabase, organizationId, day, bus.id, duty, personId),
                      )
                    }
                    busLabel={bus.registrationNumber}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function DutySelect({
  duty,
  value,
  people,
  needed,
  disabled,
  onChange,
  busLabel,
}: {
  duty: CrewJob;
  value: string;
  people: Parameters<typeof peopleForDuty>[0];
  needed: boolean;
  disabled: boolean;
  onChange: (personId: string) => void;
  busLabel: string;
}) {
  const { main, others } = peopleForDuty(people, duty, value);
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted">
      {JOB_LABELS[duty]}
      {duty === "cleaner" ? " (if any)" : ""}
      <select
        aria-label={`${JOB_LABELS[duty]} on ${busLabel}`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`${SELECT} text-ink ${needed ? "ring-2 ring-money-out/40" : ""}`}
      >
        <option value="">{duty === "cleaner" ? "No cleaner" : "Pick…"}</option>
        {main.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
            {person.active ? "" : " (left)"}
          </option>
        ))}
        {others.length ? (
          <optgroup label="Others in the crew">
            {others.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name} · {JOB_LABELS[person.job]}
                {person.active ? "" : " (left)"}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}
