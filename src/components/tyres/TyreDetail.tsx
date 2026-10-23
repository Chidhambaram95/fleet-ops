"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import {
  deleteTyre,
  getTyre,
  latestOdometers,
  listTyreEvents,
  listTyres,
  tyreBillUrl,
  undoLastTyreMove,
} from "@data/tyres/repository";
import { moduleHref, type ModuleId } from "@domain/modules/modules";
import { formatInr, todayInIst } from "@domain/operations/totals";
import type { UserRole } from "@domain/rbac/roles";
import {
  costPerKm,
  currentStintKm,
  kmByBus,
  kmSoFar,
  kmText,
  totalSpentInr,
  tyreLives,
  warrantyEndsOn,
  warrantyState,
  whereNow,
} from "@domain/tyres/calc";
import { EVENT_LABELS, positionLabel } from "@domain/tyres/catalog";
import type { Tyre, TyreEvent } from "@domain/tyres/types";
import { useOrg } from "@/components/billing/OrgContext";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { StatusPill } from "@/components/tyres/TyresPage";
import { MoveForm, TyreForm, type MoveMode } from "@/components/tyres/TyreForms";
import { Card, ErrorText, PRIMARY, SmallButton, messageFromUnknown, shortDay, useLoaded } from "@/components/ui/kit";

const ACTIONS: Record<Tyre["status"], { mode: MoveMode; label: string }[]> = {
  in_stock: [
    { mode: "fit", label: "Fit to a bus" },
    { mode: "retread_out", label: "Send for retread" },
    { mode: "repair", label: "Repair" },
    { mode: "scrap", label: "Scrap" },
  ],
  fitted: [
    { mode: "rotate", label: "Rotate" },
    { mode: "remove", label: "Remove" },
    { mode: "repair", label: "Repair" },
  ],
  at_retreader: [
    { mode: "retread_in", label: "Received back" },
    { mode: "scrap", label: "Rejected, scrap" },
  ],
  scrapped: [],
};

function eventLine(event: TyreEvent): string {
  const odometer = event.odometerKm != null ? `odometer ${event.odometerKm.toLocaleString("en-IN")}` : "";
  switch (event.kind) {
    case "fitted":
      return [`On ${event.busLabel || "a bus"}`, positionLabel(event.position), odometer].filter(Boolean).join(" · ");
    case "rotated":
      return [`${positionLabel(event.fromPosition)} → ${positionLabel(event.position)}`, odometer].filter(Boolean).join(" · ");
    case "removed":
      return [`From ${event.busLabel || "a bus"}`, positionLabel(event.position), odometer, event.reason].filter(Boolean).join(" · ");
    case "sent_for_retread":
    case "retread_received":
      return event.vendor;
    case "repair":
      return [event.reason, event.vendor, event.busLabel ? `on ${event.busLabel}` : ""].filter(Boolean).join(" · ");
    case "scrapped":
      return event.reason;
  }
}

export function TyreDetail({
  organizationId,
  module,
  role,
  tyreId,
}: {
  organizationId: string;
  module: ModuleId;
  role: UserRole | null;
  tyreId: string;
}) {
  const org = useOrg();
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const today = todayInIst();
  const { data, loading, error, reload } = useLoaded(
    async () => {
      const [tyre, events, tyres, buses, odometers] = await Promise.all([
        getTyre(supabase, organizationId, tyreId),
        listTyreEvents(supabase, organizationId, tyreId),
        listTyres(supabase, organizationId),
        createSupabaseOperationsRepository(supabase).listBuses(organizationId),
        latestOdometers(supabase, organizationId),
      ]);
      return { tyre, events, tyres, buses, odometers };
    },
    { tyre: null as Tyre | null, events: [] as TyreEvent[], tyres: [] as Tyre[], buses: [], odometers: new Map<string, number>() },
    tyreId,
  );
  const [panel, setPanel] = useState<MoveMode | "edit" | null>(null);
  const [actionError, setActionError] = useState("");
  const listHref = moduleHref(module, "tyres");
  const admin = role === "admin";

  const tyre = data.tyre;
  if (!tyre) {
    return (
      <div className="flex flex-col gap-4">
        <Link href={listHref} className="text-sm font-bold text-brand">
          ← Tyres
        </Link>
        <ErrorText message={error} />
        <p className="text-muted">{loading ? "Loading…" : "This tyre was not found."}</p>
      </div>
    );
  }

  const busName = (id: string | null) => data.buses.find((bus) => bus.id === id)?.registrationNumber ?? "Bus";
  const odometer = tyre.currentBusId ? (data.odometers.get(tyre.currentBusId) ?? null) : null;
  const km = kmSoFar(tyre, odometer);
  const stint = currentStintKm(tyre, odometer);
  const spent = totalSpentInr(tyre, data.events);
  const perKm = costPerKm(spent, km);
  const endsOn = warrantyEndsOn(tyre);
  const warranty = warrantyState(tyre, km, today);
  const lives = tyreLives(tyre, data.events);
  const byBus = kmByBus(data.events);
  const busOptions = data.buses.map((bus) => ({ id: bus.id, registrationNumber: bus.registrationNumber }));

  function done() {
    setPanel(null);
    reload();
  }

  async function undo() {
    const last = data.events[data.events.length - 1];
    if (!last || !window.confirm(`Undo "${EVENT_LABELS[last.kind]}" on ${shortDay(last.eventDate)}?`)) return;
    setActionError("");
    try {
      await undoLastTyreMove(supabase, tyre!.id);
      reload();
    } catch (undoError) {
      setActionError(messageFromUnknown(undoError));
    }
  }

  async function remove() {
    if (!window.confirm(`Delete tyre ${tyre!.tyreNumber} and all its history? This cannot be undone.`)) return;
    try {
      await deleteTyre(supabase, organizationId, tyre!.id);
      router.push(listHref);
    } catch (removeError) {
      setActionError(messageFromUnknown(removeError));
    }
  }

  async function openBill() {
    try {
      const url = await tyreBillUrl(supabase, tyre!.billPhotoPath);
      if (url) window.open(url, "_blank", "noopener");
    } catch (photoError) {
      setActionError(messageFromUnknown(photoError));
    }
  }

  const form =
    panel === "edit" ? (
      <TyreForm
        supabase={supabase}
        organizationId={organizationId}
        tyre={tyre}
        tyres={data.tyres}
        buses={busOptions}
        odometers={data.odometers}
        onDone={done}
        onCancel={() => setPanel(null)}
      />
    ) : panel ? (
      <MoveForm
        key={panel}
        supabase={supabase}
        mode={panel}
        tyre={tyre}
        tyres={data.tyres}
        buses={busOptions}
        odometers={data.odometers}
        onDone={done}
        onCancel={() => setPanel(null)}
      />
    ) : null;

  const warrantyText = [
    endsOn ? `till ${shortDay(endsOn)}` : "",
    tyre.warrantyKm ? `${kmText(tyre.warrantyKm)} (${kmText(km)} used)` : "",
  ]
    .filter(Boolean)
    .join(" or ");

  return (
    <div className="flex flex-col gap-4">
      <Link href={listHref} className="text-sm font-bold text-brand">
        ← Tyres
      </Link>

      <section className="flex flex-col gap-3 rounded-3xl bg-brand p-4 text-white md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-brand-pale">Tyre number</p>
            <h1 className="truncate text-2xl font-extrabold">{tyre.tyreNumber}</h1>
            <p className="text-sm text-brand-pale">
              {[tyre.brand, tyre.size, tyre.boughtAs === "retreaded" ? "bought retreaded" : ""].filter(Boolean).join(" · ") ||
                "No brand entered"}
            </p>
          </div>
          <StatusPill status={tyre.status} />
        </div>
        <p className="font-semibold">{whereNow(tyre, busName)}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xl font-extrabold">{kmText(km)}</p>
            <p className="text-xs text-brand-pale">{stint ? `incl. ${kmText(stint)} on this bus so far` : "Total run"}</p>
          </div>
          <div>
            <p className="text-xl font-extrabold">{tyre.retreadCount}</p>
            <p className="text-xs text-brand-pale">Retreads</p>
          </div>
          <div>
            <p className="text-xl font-extrabold">{formatInr(spent)}</p>
            <p className="text-xs text-brand-pale">Spent (price, retreads, repairs)</p>
          </div>
          <div>
            <p className="text-xl font-extrabold">{perKm != null ? `₹${perKm.toFixed(2)}` : "–"}</p>
            <p className="text-xs text-brand-pale">Per km</p>
          </div>
        </div>
      </section>

      {!org.viewOnly && ACTIONS[tyre.status].length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ACTIONS[tyre.status].map((action, index) => (
            <button
              key={action.mode}
              type="button"
              onClick={() => setPanel(action.mode)}
              className={index === 0 ? PRIMARY : "h-12 rounded-2xl bg-white px-5 text-[15px] font-bold text-brand"}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      <ErrorText message={actionError} />

      <div className="grid gap-4 md:grid-cols-[1fr_380px] md:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {form ? <div className="md:hidden">{form}</div> : null}

          <Card title="Life of this tyre">
            <ol className="flex flex-col">
              {lives.map((life, index) => (
                <li key={life.number} className="relative flex gap-3 pb-4 last:pb-0">
                  {index < lives.length - 1 ? <span className="absolute left-[15px] top-8 h-full w-0.5 bg-brand-pale" /> : null}
                  <span
                    className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${
                      life.ended ? "bg-brand-soft text-brand" : "bg-brand text-white"
                    }`}
                  >
                    {life.number === 0 ? "N" : `R${life.number}`}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {life.number === 0 ? `Bought ${shortDay(life.startedOn)}` : `Retread ${life.number} · back ${shortDay(life.startedOn)}`}
                      {life.costInr ? ` · ${formatInr(life.costInr)}` : ""}
                    </p>
                    <p className="text-xs text-muted">
                      {life.costInr
                        ? life.chargedTo
                          ? `Charged to ${life.chargedTo} on ${shortDay(life.chargedOn ?? "")}`
                          : "Will be charged to the next bus it is fitted on"
                        : "No cost entered"}
                    </p>
                    <p className="text-xs text-muted">
                      {[life.buses.length ? `Ran on ${life.buses.join(", ")}` : "Not fitted yet", life.km ? kmText(life.km) : ""]
                        .filter(Boolean)
                        .join(" · ")}
                      {!life.ended && stint ? ` · ${kmText(stint)} so far on the current bus` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card
            title="History"
            action={
              admin && !org.viewOnly && data.events.length ? (
                <SmallButton onClick={undo}>Undo last</SmallButton>
              ) : null
            }
          >
            {data.events.length === 0 ? (
              <p className="text-muted">Nothing yet. Fit it to a bus to start its history.</p>
            ) : (
              <div>
                {[...data.events].reverse().map((event, index) => (
                  <div key={event.id} className={`flex items-start justify-between gap-3 py-3 ${index ? "border-t border-line" : ""}`}>
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {EVENT_LABELS[event.kind]}
                        <span className="font-normal text-muted"> · {shortDay(event.eventDate)}</span>
                      </p>
                      <p className="text-xs text-muted">{eventLine(event)}</p>
                      {event.note ? <p className="text-xs text-muted">{event.note}</p> : null}
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      {event.kmRun != null && (event.kind === "removed" || event.kind === "rotated") ? (
                        <p className="font-bold">{kmText(event.kmRun)}</p>
                      ) : null}
                      {event.costInr ? <p className="text-muted">Bill {formatInr(event.costInr)}</p> : null}
                      {event.chargeInr ? (
                        <p className="font-bold text-money-out">
                          {formatInr(event.chargeInr)} to {event.busLabel}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <aside className="flex flex-col gap-4 md:sticky md:top-24">
          {form ? <div className="hidden md:block">{form}</div> : null}
          <Card title="Warranty">
            {warranty === "none" ? (
              <p className="text-sm text-muted">No warranty entered.</p>
            ) : (
              <p
                className={`rounded-2xl px-4 py-3 text-sm font-semibold ${
                  warranty === "over" ? "bg-money-out text-white" : warranty === "ending" ? "bg-warn-bg text-warn-ink" : "bg-brand-soft text-brand"
                }`}
              >
                {warranty === "over" ? "Warranty over" : warranty === "ending" ? "Warranty ending soon" : "Under warranty"}: {warrantyText}
              </p>
            )}
            {tyre.warrantyNote ? <p className="text-sm text-muted">{tyre.warrantyNote}</p> : null}
          </Card>
          <Card title="Details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Bought</dt>
              <dd>
                {shortDay(tyre.purchaseDate)}
                {tyre.vendor ? ` · ${tyre.vendor}` : ""}
              </dd>
              <dt className="text-muted">Price</dt>
              <dd>{tyre.purchasePriceInr != null ? formatInr(tyre.purchasePriceInr) : "–"}</dd>
              {tyre.unchargedInr ? (
                <>
                  <dt className="text-muted">Next bus pays</dt>
                  <dd>{formatInr(tyre.unchargedInr)}</dd>
                </>
              ) : null}
              {byBus.length ? (
                <>
                  <dt className="text-muted">Km by bus</dt>
                  <dd>{byBus.map((item) => `${item.busLabel} ${kmText(item.km)}`).join(", ")}</dd>
                </>
              ) : null}
              {tyre.note ? (
                <>
                  <dt className="text-muted">Note</dt>
                  <dd>{tyre.note}</dd>
                </>
              ) : null}
            </dl>
            <div className="flex flex-wrap gap-1">
              {tyre.billPhotoPath ? (
                <SmallButton tone="brand" onClick={openBill}>
                  Bill photo
                </SmallButton>
              ) : null}
              {!org.viewOnly ? (
                <SmallButton tone="brand" onClick={() => setPanel("edit")}>
                  Edit details
                </SmallButton>
              ) : null}
              {admin && !org.viewOnly ? <SmallButton onClick={remove}>Delete tyre</SmallButton> : null}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
