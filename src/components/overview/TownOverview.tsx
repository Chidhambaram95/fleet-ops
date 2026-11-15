"use client";

import Link from "next/link";
import { moduleHref, MODULE_TITLES } from "@domain/modules/modules";
import { displayDate, formatInr } from "@domain/operations/totals";
import { useAlerts } from "@/components/alerts/AlertsProvider";
import { useDayBook } from "@/components/operations/daybook/useDayBook";
import { NeedsAttention } from "./NeedsAttention";
import { BestWorstCard } from "@/components/reports/BestWorstCard";
import { Card, Empty, ErrorText, KpiTile, PageHeader } from "@/components/ui/primitives";

const tone = (value: number) => (value > 0 ? "text-money-in" : value < 0 ? "text-money-out" : "text-ink");

/** Town's Overview: today's money, what needs attention, and each bus today. Read-only. */
export function TownOverview() {
  const book = useDayBook("town");
  const alerts = useAlerts();
  const { loading, error, fleetTotals, visibleBuses, busTotals, odometers, organizationId, supabase, date } = book;
  const daybook = moduleHref("town", "daybook");

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <PageHeader title="Overview" hint={`${MODULE_TITLES.town} · today, ${displayDate(date)}`} />
      <ErrorText message={error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <KpiTile
          href={daybook}
          label="Profit today"
          value={loading ? "…" : formatInr(fleetTotals.netInr)}
          tone={fleetTotals.netInr > 0 ? "in" : fleetTotals.netInr < 0 ? "out" : undefined}
          detail="Money in less money out"
        />
        <KpiTile href={daybook} label="Money in" value={loading ? "…" : formatInr(fleetTotals.incomeInr)} detail="Today" />
        <KpiTile href={daybook} label="Money out" value={loading ? "…" : formatInr(fleetTotals.expenseInr)} detail="Today" />
        <KpiTile
          href={moduleHref("town", "health")}
          label="Needs attention"
          value={alerts.count}
          tone={alerts.expired ? "out" : undefined}
          detail={alerts.count ? "Documents, mileage and EMIs" : "All clear"}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <NeedsAttention module="town" />
        {organizationId ? <BestWorstCard supabase={supabase} organizationId={organizationId} module="town" /> : null}
      </div>
      <Card
        title="Buses today"
        action={
          <Link href={daybook} className="text-sm font-medium text-brand hover:text-brand-dark">
            Open day book
          </Link>
        }
      >
        {visibleBuses.length === 0 ? (
          <Empty>{loading ? "Loading your buses…" : "No buses yet."}</Empty>
        ) : (
          <>
            <div className="hidden overflow-x-auto rounded-xl border border-line lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-subtle text-left text-xs font-medium uppercase tracking-wide text-muted">
                    <th className="h-10 whitespace-nowrap px-3 first:pl-4">Bus</th>
                    <th className="h-10 whitespace-nowrap px-3">Route</th>
                    <th className="h-10 whitespace-nowrap px-3 text-right">Money in</th>
                    <th className="h-10 whitespace-nowrap px-3 text-right">Money out</th>
                    <th className="h-10 whitespace-nowrap px-3 text-right">Profit</th>
                    <th className="h-10 whitespace-nowrap px-3 text-right last:pr-4">Odometer</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBuses.map((bus) => {
                    const totals = busTotals.get(bus.id);
                    const net = totals?.netInr ?? 0;
                    return (
                      <tr key={bus.id} className="hover:bg-subtle">
                        <td className="h-12 border-t border-line px-3 font-medium text-ink first:pl-4">
                          {bus.registrationNumber}
                        </td>
                        <td className="h-12 border-t border-line px-3 text-muted">{bus.routeLabel || "No route"}</td>
                        <td className="h-12 border-t border-line px-3 text-right tabular-nums">
                          {formatInr(totals?.incomeInr ?? 0)}
                        </td>
                        <td className="h-12 border-t border-line px-3 text-right tabular-nums">
                          {formatInr(totals?.expenseInr ?? 0)}
                        </td>
                        <td className={`h-12 border-t border-line px-3 text-right font-semibold tabular-nums ${tone(net)}`}>
                          {formatInr(net)}
                        </td>
                        <td className="h-12 border-t border-line px-3 text-right tabular-nums text-muted last:pr-4">
                          {odometers.has(bus.id) ? `${odometers.get(bus.id)?.toLocaleString("en-IN")} km` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line lg:hidden">
              {visibleBuses.map((bus) => {
                const net = busTotals.get(bus.id)?.netInr ?? 0;
                return (
                  <li key={bus.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{bus.registrationNumber}</p>
                      <p className="truncate text-xs text-muted">
                        {bus.routeLabel || "No route"}
                        {odometers.has(bus.id) ? ` · ${odometers.get(bus.id)?.toLocaleString("en-IN")} km` : ""}
                      </p>
                    </div>
                    <span className={`text-sm font-semibold tabular-nums ${tone(net)}`}>{formatInr(net)}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
