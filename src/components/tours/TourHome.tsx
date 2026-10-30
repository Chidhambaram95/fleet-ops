"use client";

import Link from "next/link";
import { useMemo } from "react";
import { listTripsWithLines } from "@data/trips/repository";
import { MODULE_TITLES, moduleHref } from "@domain/modules/modules";
import { formatInr, todayInIst } from "@domain/operations/totals";
import { balanceDue, isRunning, isUpcoming } from "@domain/tours/calc";
import { quoteNumber, tripLine, whenLine } from "@domain/tours/messages";
import { useOrg } from "@/components/billing/OrgContext";
import { MileageCard } from "@/components/mileage/MileageAlerts";
import { RenewalsDueCard } from "@/components/renewals/RenewalsDueCard";
import { Card, ErrorText, PageHeader, useLoaded } from "@/components/ui/kit";
import { StatusPill, useTourData } from "./shared";

/** Home of the Tour module: tours on the road, tours coming, and money to collect. */
export function TourHome({ organizationId }: { organizationId: string }) {
  const org = useOrg();
  const today = todayInIst();
  const { supabase, data, loading, error } = useTourData(organizationId);
  const { data: toApprove } = useLoaded(
    async () => {
      const trips = await listTripsWithLines(supabase, organizationId, { limit: 2000 });
      const ids = new Set(data.buses.map((bus) => bus.id));
      return trips.filter((trip) => trip.status === "draft" && ids.has(trip.busId)).length;
    },
    0,
    `${data.buses.length}`,
  );

  const figures = useMemo(() => {
    const confirmed = data.bookings.filter((item) => item.status === "confirmed" || item.status === "completed");
    return {
      running: data.bookings.filter((item) => isRunning(item, today)),
      upcoming: data.bookings.filter((item) => isUpcoming(item, today)),
      dues: confirmed.reduce((total, item) => total + balanceDue(item, data.payments), 0),
      dueCount: confirmed.filter((item) => balanceDue(item, data.payments) > 0).length,
      openEnquiries: data.bookings.filter((item) => item.status === "enquiry" || item.status === "quoted").length,
    };
  }, [data, today]);

  const tiles = [
    {
      href: moduleHref("tour", "bookings"),
      label: "Tours running now",
      value: String(figures.running.length),
      detail: figures.running.length ? "On the road today" : "No tour on the road",
    },
    {
      href: moduleHref("tour", "bookings"),
      label: "Upcoming tours",
      value: String(figures.upcoming.length),
      detail: "Confirmed and still to start",
    },
    {
      href: moduleHref("tour", "bookings"),
      label: "Balance to collect",
      value: formatInr(figures.dues),
      detail: figures.dueCount ? `From ${figures.dueCount} customer${figures.dueCount === 1 ? "" : "s"}` : "Nothing due",
      tone: figures.dues ? ("out" as const) : undefined,
    },
    {
      href: moduleHref("tour", "trips"),
      label: "Trips to approve",
      value: String(toApprove),
      detail: toApprove ? "Check and approve the trip sheets" : "All trip sheets approved",
    },
  ];
  const coming = [...figures.running, ...figures.upcoming]
    .sort((left, right) => left.startDate.localeCompare(right.startDate))
    .slice(0, 6);
  const busName = (id: string | null) => data.buses.find((bus) => bus.id === id)?.registrationNumber ?? "No bus";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={MODULE_TITLES.tour}
        hint={loading ? "Loading…" : `${data.buses.length} bus${data.buses.length === 1 ? "" : "es"}`}
        action={
          !org.viewOnly ? (
            <Link
              href={`${moduleHref("tour", "enquiries")}?new=1`}
              className="flex min-h-12 items-center gap-2 rounded-2xl bg-brand px-5 text-[15px] font-bold text-white"
            >
              <span aria-hidden="true" className="text-xl leading-none">+</span>
              New enquiry
            </Link>
          ) : null
        }
      />
      <ErrorText message={error} />
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className="flex min-w-0 flex-col gap-1 rounded-3xl bg-white p-4">
            <span className="text-[13px] font-semibold text-muted">{tile.label}</span>
            <span className={`text-xl font-extrabold ${tile.tone === "out" ? "text-money-out" : ""}`}>
              {loading ? "…" : tile.value}
            </span>
            <span className="text-xs text-muted">{tile.detail}</span>
          </Link>
        ))}
      </div>
      <Card
        title="Tours coming up"
        action={
          <Link href={moduleHref("tour", "enquiries")} className="text-[13px] font-semibold text-brand">
            {figures.openEnquiries} open enquir{figures.openEnquiries === 1 ? "y" : "ies"}
          </Link>
        }
      >
        {coming.length === 0 ? (
          <p className="text-sm text-muted">No confirmed tours yet. Start with a new enquiry.</p>
        ) : (
          coming.map((booking, index) => (
            <div key={booking.id} className={`flex items-center justify-between gap-3 py-2 ${index ? "border-t border-line" : ""}`}>
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {booking.customerName} · {tripLine(booking)}
                </p>
                <p className="truncate text-xs text-muted">
                  {busName(booking.busId)} · {whenLine(booking)} · {quoteNumber(booking)}
                </p>
              </div>
              <StatusPill status={booking.status}>{isRunning(booking, today) ? "Running" : undefined}</StatusPill>
            </div>
          ))
        )}
      </Card>
      <RenewalsDueCard supabase={supabase} organizationId={organizationId} module="tour" />
      <MileageCard supabase={supabase} organizationId={organizationId} module="tour" />
      {!loading && data.buses.length === 0 ? (
        <p className="rounded-3xl bg-white px-4 py-6 text-muted">
          No tour buses yet.{" "}
          <Link href={moduleHref("tour", "buses")} className="font-bold text-brand">
            Add a bus
          </Link>
        </p>
      ) : null}
    </div>
  );
}
