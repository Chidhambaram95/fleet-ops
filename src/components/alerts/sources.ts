"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listCrewPeople } from "@data/crew/people";
import { getEmiReminderDays, listLoans } from "@data/loans/repository";
import { loadMileage } from "@data/mileage/repository";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { listRenewals } from "@data/renewals/repository";
import { emiAlertText, emiAlerts, loansForModule, type EmiAlert } from "@domain/loans/emis";
import { mileageSummary, type BusMileageView } from "@domain/mileage/mileage";
import { moduleHref, type ModuleId } from "@domain/modules/modules";
import { shiftDate, todayInIst } from "@domain/operations/totals";
import { currentRenewals, daysLeft, renewalLabel } from "@domain/renewals/catalog";

/** Where each kind of alert is dealt with. */
export const emiHref = (module: ModuleId) => `${moduleHref(module, "renewals")}?section=loans`;

export type EmiAlertLine = { kind: EmiAlert["kind"]; text: string };

/** EMI alerts for a module's loans, as lines of text. Empty before migration 0027. */
export function useEmiAlerts(
  supabase: SupabaseClient,
  organizationId: string,
  module: ModuleId | null | undefined,
  refreshKey = "",
) {
  const [lines, setLines] = useState<EmiAlertLine[]>([]);
  useEffect(() => {
    if (!organizationId || !module) {
      setLines([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      listLoans(supabase, organizationId, { quiet: true }),
      getEmiReminderDays(supabase, organizationId),
      createSupabaseOperationsRepository(supabase).listBuses(organizationId),
    ])
      .then(([{ loans, emis }, reminderDays, buses]) => {
        if (cancelled) return;
        const byId = new Map(buses.map((bus) => [bus.id, bus]));
        const mine = loansForModule(loans, (id) => byId.get(id)?.busType, module);
        const name = (id: string) => byId.get(id)?.registrationNumber ?? "Bus";
        setLines(
          emiAlerts(mine, emis, todayInIst(), reminderDays).map((alert) => ({
            kind: alert.kind,
            text: emiAlertText(alert, name),
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supabase, organizationId, module, refreshKey]);
  return lines;
}

/** Buses with an open mileage alert in the last 30 days, worst first. */
export function useMileageProblems(
  supabase: SupabaseClient,
  organizationId: string,
  module: ModuleId | null,
  refreshKey = "",
) {
  const [problems, setProblems] = useState<BusMileageView[]>([]);
  useEffect(() => {
    if (!organizationId || !module) {
      setProblems([]);
      return;
    }
    let cancelled = false;
    const to = todayInIst();
    loadMileage(supabase, organizationId, module)
      .then((data) => {
        if (cancelled) return;
        const summary = mileageSummary({ ...data, from: shiftDate(to, -30), to });
        setProblems(summary.buses.filter((view) => view.status === "alert" || view.status === "warn"));
      })
      // No access or no data yet: nothing to show.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supabase, organizationId, module, refreshKey]);
  return problems;
}

export type RenewalAlert = { id: string; owner: string; label: string; days: number };

/** Documents of a module's buses and drivers that expire within 30 days (or already have), soonest first. */
export function useRenewalAlerts(
  supabase: SupabaseClient,
  organizationId: string,
  module: ModuleId | null,
  refreshKey = "",
) {
  const [items, setItems] = useState<RenewalAlert[]>([]);
  useEffect(() => {
    if (!organizationId || !module) {
      setItems([]);
      return;
    }
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
              renewal.busId
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
            .filter((item) => item.days <= 30)
            .sort((left, right) => left.days - right.days),
        );
      })
      // Before the renewals table exists there is nothing to show.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supabase, organizationId, module, refreshKey]);
  return items;
}
