"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listCrewPeople } from "@data/money/repository";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { listRenewals } from "@data/renewals/repository";
import { moduleHref, type ModuleId } from "@domain/modules/modules";
import { todayInIst } from "@domain/operations/totals";
import { currentRenewals, daysLeft, dueText, renewalLabel } from "@domain/renewals/catalog";

type DueItem = { id: string; owner: string; label: string; days: number };

/** Home screen card: documents expiring in the next 30 days. Hidden when nothing is due. */
export function RenewalsDueCard({
  supabase,
  organizationId,
  module,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  /** Only this module's buses and drivers. */
  module?: ModuleId;
}) {
  const [items, setItems] = useState<DueItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listRenewals(supabase, organizationId),
      createSupabaseOperationsRepository(supabase).listBuses(organizationId),
      listCrewPeople(supabase, organizationId),
    ])
      .then(([renewals, buses, people]) => {
        if (cancelled) return;
        const today = todayInIst();
        setItems(
          currentRenewals(renewals)
            .filter((renewal) =>
              !module
                ? true
                : renewal.busId
                  ? buses.find((bus) => bus.id === renewal.busId)?.busType === module
                  : people.find((person) => person.id === renewal.personId)?.module === module,
            )
            .map((renewal) => ({
              id: renewal.id,
              owner: renewal.busId
                ? (buses.find((bus) => bus.id === renewal.busId)?.registrationNumber ?? "Bus")
                : (people.find((person) => person.id === renewal.personId)?.name ?? "Driver"),
              label: renewalLabel(renewal.kind),
              days: daysLeft(renewal.expiresOn, today),
            }))
            .filter((item) => item.days <= 30),
        );
      })
      // Before the renewals table exists the card simply stays hidden.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supabase, organizationId, module]);

  if (items.length === 0) {
    return null;
  }
  return (
    <Link
      href={module ? moduleHref(module, "renewals") : "/renewals"}
      className="flex flex-col gap-2 rounded-3xl bg-warn-bg p-4 text-warn-ink"
    >
      <span className="flex items-center justify-between gap-2 font-extrabold">
        <span>
          {items.length} renewal{items.length === 1 ? "" : "s"} due soon
        </span>
        <span aria-hidden="true">›</span>
      </span>
      {items.slice(0, 3).map((item) => (
        <span key={item.id} className="flex justify-between gap-3 text-sm">
          <span className="truncate">
            {item.owner} · {item.label}
          </span>
          <span className={`shrink-0 font-bold ${item.days <= 7 ? "text-money-out" : ""}`}>
            {dueText(item.days)}
          </span>
        </span>
      ))}
      {items.length > 3 ? <span className="text-xs">and {items.length - 3} more</span> : null}
    </Link>
  );
}
