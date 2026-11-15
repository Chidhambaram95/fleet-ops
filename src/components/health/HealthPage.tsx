"use client";

import Link from "next/link";
import { useMemo } from "react";
import { listCrewPeople } from "@data/crew/people";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { listRenewals } from "@data/renewals/repository";
import { MODULE_TITLES, moduleHref, type ModuleId } from "@domain/modules/modules";
import { todayInIst } from "@domain/operations/totals";
import {
  BUS_DOCUMENTS,
  currentRenewals,
  daysLeft,
  dueStatus,
  dueText,
  DRIVER_DOCUMENTS,
  type DueStatus,
} from "@domain/renewals/catalog";
import type { Renewal, RenewalKind } from "@domain/renewals/types";
import { useAlerts } from "@/components/alerts/AlertsProvider";
import { emiHref } from "@/components/alerts/sources";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { Card, Empty, ErrorText, KpiTile, PageHeader, useLoaded } from "@/components/ui/kit";
import { HealthTabs } from "./HealthTabs";

const CELL: Record<DueStatus, string> = {
  expired: "bg-danger-bg text-money-out",
  due: "bg-danger-bg text-money-out",
  soon: "bg-warn-bg text-warn-ink",
  ok: "bg-success-bg text-money-in",
};

/** "12 d" or "Expired", short enough for a table cell. */
function shortDue(days: number) {
  return days < 0 ? "Expired" : days === 0 ? "Today" : `${days} d`;
}

function Cell({ renewal, today }: { renewal: Renewal | undefined; today: string }) {
  if (!renewal) return <span className="text-faint">—</span>;
  const days = daysLeft(renewal.expiresOn, today);
  return (
    <span
      title={dueText(days)}
      className={`inline-flex h-7 items-center justify-center rounded-md px-2 text-xs font-medium tabular-nums ${CELL[dueStatus(days)]}`}
    >
      {shortDue(days)}
    </span>
  );
}

/** Fleet health: every bus against every document, with mileage and EMI alerts beside it. Read-only. */
export function HealthPage({ organizationId, module }: { organizationId: string; module: ModuleId }) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const alerts = useAlerts();
  const today = todayInIst();
  const { data, loading, error } = useLoaded(
    async () => {
      const [renewals, allBuses, people] = await Promise.all([
        listRenewals(supabase, organizationId),
        createSupabaseOperationsRepository(supabase).listBuses(organizationId),
        listCrewPeople(supabase, organizationId),
      ]);
      const buses = allBuses.filter((bus) => bus.busType === module);
      const drivers = people.filter((person) => person.module === module && person.active);
      const busIds = new Set(buses.map((bus) => bus.id));
      const personIds = new Set(drivers.map((person) => person.id));
      const mine = currentRenewals(renewals).filter((item) =>
        item.busId ? busIds.has(item.busId) : item.personId ? personIds.has(item.personId) : false,
      );
      return { buses, drivers, renewals: mine };
    },
    { buses: [], drivers: [], renewals: [] } as {
      buses: { id: string; registrationNumber: string; routeLabel: string }[];
      drivers: { id: string; name: string }[];
      renewals: Renewal[];
    },
    `${organizationId}:${module}`,
  );

  const counts = useMemo(() => {
    const result = { expired: 0, due: 0, soon: 0, ok: 0 };
    for (const item of data.renewals) result[dueStatus(daysLeft(item.expiresOn, today))] += 1;
    return result;
  }, [data.renewals, today]);

  const forOwner = (field: "busId" | "personId", id: string, kind: RenewalKind) =>
    data.renewals.find((item) => item[field] === id && item.kind === kind);

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <PageHeader title="Fleet health" hint={`${MODULE_TITLES[module]} · documents, mileage, loans and EMIs`} />
      <HealthTabs module={module} />
      <ErrorText message={error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <KpiTile
          href={moduleHref(module, "renewals")}
          label="Expired"
          value={loading ? "…" : counts.expired}
          tone={counts.expired ? "out" : undefined}
          detail="Past the date"
        />
        <KpiTile
          href={moduleHref(module, "renewals")}
          label="Within 7 days"
          value={loading ? "…" : counts.due}
          tone={counts.due ? "out" : undefined}
          detail="Renew this week"
        />
        <KpiTile href={moduleHref(module, "renewals")} label="Within 30 days" value={loading ? "…" : counts.soon} detail="Plan the renewal" />
        <KpiTile href={moduleHref(module, "renewals")} label="In date" value={loading ? "…" : counts.ok} detail="More than 30 days left" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
        <KpiTile
          href={moduleHref(module, "mileage")}
          label="Mileage"
          value={alerts.mileage.length}
          tone={alerts.mileage.length ? "out" : undefined}
          detail={alerts.mileage.length ? `${alerts.mileage.length === 1 ? "Bus needs" : "Buses need"} a look` : "All buses look fine"}
        />
        <KpiTile
          href={emiHref(module)}
          label="Loans & EMIs"
          value={alerts.emis.length}
          tone={alerts.emis.some((line) => line.kind === "overdue") ? "out" : undefined}
          detail={alerts.emis[0]?.text ?? "Nothing to fund or confirm"}
        />
      </div>

      <Card title="Bus documents" action={<Link href={moduleHref(module, "renewals")} className="text-sm font-medium text-brand hover:text-brand-dark">Add or renew</Link>}>
        {data.buses.length === 0 ? (
          <Empty>{loading ? "Loading…" : "No buses in this module yet."}</Empty>
        ) : (
          <>
            <div className="hidden overflow-x-auto rounded-xl border border-line lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-subtle text-left text-xs font-medium uppercase tracking-wide text-muted">
                    <th className="h-10 whitespace-nowrap px-3 first:pl-4">Bus</th>
                    {BUS_DOCUMENTS.map((doc) => (
                      <th key={doc.id} className="h-10 whitespace-nowrap px-3 text-center last:pr-4">
                        {doc.label.replace(" (fitness)", "")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.buses.map((bus) => (
                    <tr key={bus.id} className="hover:bg-subtle">
                      <td className="h-12 whitespace-nowrap border-t border-line px-3 font-medium text-ink first:pl-4">
                        {bus.registrationNumber}
                      </td>
                      {BUS_DOCUMENTS.map((doc) => (
                        <td key={doc.id} className="h-12 border-t border-line px-3 text-center last:pr-4">
                          <Cell renewal={forOwner("busId", bus.id, doc.id)} today={today} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="flex flex-col divide-y divide-line lg:hidden">
              {data.buses.map((bus) => (
                <li key={bus.id} className="flex flex-col gap-2 py-3">
                  <p className="text-sm font-medium text-ink">{bus.registrationNumber}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {BUS_DOCUMENTS.map((doc) => (
                      <span key={doc.id} className="flex items-center gap-1.5 text-xs text-muted">
                        {doc.label.replace(" (fitness)", "")}
                        <Cell renewal={forOwner("busId", bus.id, doc.id)} today={today} />
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title="Drivers">
        {data.drivers.length === 0 ? (
          <Empty>{loading ? "Loading…" : "No drivers in this module yet."}</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {data.drivers.map((person) => (
              <li key={person.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                <p className="text-sm font-medium text-ink">{person.name}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {DRIVER_DOCUMENTS.map((doc) => (
                    <span key={doc.id} className="flex items-center gap-1.5 text-xs text-muted">
                      {doc.label}
                      <Cell renewal={forOwner("personId", person.id, doc.id)} today={today} />
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
