"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { latestOdometers, listTyreEventsBetween, listTyres } from "@data/tyres/repository";
import { moduleHref, type ModuleId } from "@domain/modules/modules";
import { formatInr, todayInIst } from "@domain/operations/totals";
import { chargesByBus, kmSoFar, kmText, warrantyState, whereNow } from "@domain/tyres/calc";
import { STATUS_LABELS } from "@domain/tyres/catalog";
import type { Tyre, TyreStatus } from "@domain/tyres/types";
import { useOrg } from "@/components/billing/OrgContext";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { BusTyreMap } from "@/components/tyres/BusTyreMap";
import { MoveForm, TyreForm, type MoveMode } from "@/components/tyres/TyreForms";
import { Card, Empty, ErrorText, FIELD, PageHeader, PRIMARY, SmallButton, Tabs, useLoaded } from "@/components/ui/kit";

type Section = "buses" | "all" | "retread";

const STATUS_CLASS: Record<TyreStatus, string> = {
  fitted: "bg-brand-soft text-brand",
  in_stock: "bg-canvas text-ink",
  at_retreader: "bg-warn-bg text-warn-ink",
  scrapped: "bg-line text-muted",
};

export function StatusPill({ status }: { status: TyreStatus }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${STATUS_CLASS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

type Panel =
  | { kind: "new" }
  | { kind: "move"; mode: MoveMode; tyre: Tyre | null; slot?: { busId: string; position: string } };

export function TyresPage({ organizationId, module }: { organizationId: string; module: ModuleId }) {
  const org = useOrg();
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const today = todayInIst();
  const monthStart = `${today.slice(0, 8)}01`;
  const { data, loading, error, reload } = useLoaded(
    async () => {
      const [tyres, buses, odometers, monthEvents] = await Promise.all([
        listTyres(supabase, organizationId),
        createSupabaseOperationsRepository(supabase).listBuses(organizationId),
        latestOdometers(supabase, organizationId),
        listTyreEventsBetween(supabase, organizationId, { from: monthStart, to: today }),
      ]);
      return { tyres, buses, odometers, monthEvents };
    },
    { tyres: [] as Tyre[], buses: [], odometers: new Map<string, number>(), monthEvents: [] },
  );

  const [section, setSection] = useState<Section>("buses");
  const [allBuses, setAllBuses] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | TyreStatus>("");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [extraSpares, setExtraSpares] = useState<Record<string, number>>({});

  // Tyres move between every bus of the company; a module shows its own buses first.
  const moduleBusIds = new Set(data.buses.filter((bus) => bus.busType === module).map((bus) => bus.id));
  const shownBuses = data.buses.filter((bus) => allBuses || moduleBusIds.has(bus.id));
  const busName = (id: string | null) => data.buses.find((bus) => bus.id === id)?.registrationNumber ?? "Bus";
  const odometerOf = (tyre: Tyre) => (tyre.currentBusId ? (data.odometers.get(tyre.currentBusId) ?? null) : null);
  const inModule = (tyre: Tyre) => tyre.status !== "fitted" || moduleBusIds.has(tyre.currentBusId ?? "");

  const tyres = data.tyres;
  const counts = {
    fitted: tyres.filter((tyre) => tyre.status === "fitted").length,
    stock: tyres.filter((tyre) => tyre.status === "in_stock").length,
    retreader: tyres.filter((tyre) => tyre.status === "at_retreader").length,
    warranty: tyres.filter(
      (tyre) => tyre.status !== "scrapped" && warrantyState(tyre, kmSoFar(tyre, odometerOf(tyre)), today) === "ending",
    ).length,
  };
  const monthCharges = chargesByBus(data.monthEvents);

  const listed = tyres
    .filter((tyre) => allBuses || inModule(tyre))
    .filter((tyre) => !statusFilter || tyre.status === statusFilter)
    .filter((tyre) => {
      const query = search.trim().toLowerCase();
      if (!query) return true;
      return [tyre.tyreNumber, tyre.brand, tyre.size, busName(tyre.currentBusId)].some((text) =>
        text.toLowerCase().includes(query),
      );
    });
  const atRetreader = tyres.filter((tyre) => tyre.status === "at_retreader");
  const waiting = tyres.filter((tyre) => tyre.status === "in_stock" && tyre.retreadCount > 0);
  const tyreHref = (tyre: Tyre) => `${moduleHref(module, "tyres")}/${tyre.id}`;

  function open(next: Panel) {
    setPanel(next);
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function done() {
    setPanel(null);
    reload();
  }

  const busOptions = data.buses.map((bus) => ({ id: bus.id, registrationNumber: bus.registrationNumber }));
  const form = panel ? (
    panel.kind === "new" ? (
      <TyreForm
        supabase={supabase}
        organizationId={organizationId}
        tyre={null}
        tyres={tyres}
        buses={busOptions}
        odometers={data.odometers}
        onDone={done}
        onCancel={() => setPanel(null)}
      />
    ) : (
      <MoveForm
        key={`${panel.mode}:${panel.tyre?.id ?? ""}:${panel.slot?.busId ?? ""}:${panel.slot?.position ?? ""}`}
        supabase={supabase}
        mode={panel.mode}
        tyre={panel.tyre}
        slot={panel.slot}
        tyres={tyres}
        buses={busOptions}
        odometers={data.odometers}
        onDone={done}
        onCancel={() => setPanel(null)}
      />
    )
  ) : null;

  const tyreRow = (tyre: Tyre, index: number, actions?: React.ReactNode) => (
    <div key={tyre.id} className={`flex items-center justify-between gap-3 py-3 ${index ? "border-t border-line" : ""}`}>
      <Link href={tyreHref(tyre)} className="min-w-0 grow">
        <p className="truncate font-semibold">
          {tyre.tyreNumber}
          <span className="font-normal text-muted">
            {[tyre.brand, tyre.size].filter(Boolean).length ? ` · ${[tyre.brand, tyre.size].filter(Boolean).join(" ")}` : ""}
          </span>
        </p>
        <p className="truncate text-xs text-muted">
          {whereNow(tyre, busName)} · {kmText(kmSoFar(tyre, odometerOf(tyre)))}
          {tyre.retreadCount ? ` · retread ${tyre.retreadCount}×` : ""}
        </p>
      </Link>
      <div className="flex shrink-0 items-center gap-1">{actions ?? <StatusPill status={tyre.status} />}</div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Tyres"
        hint="Every tyre, which bus it is on, its km, retreads and warranty."
        action={
          !org.viewOnly ? (
            <button type="button" className={PRIMARY} onClick={() => open({ kind: "new" })}>
              + New tyre
            </button>
          ) : null
        }
      />
      <ErrorText message={error} />

      <section className="grid grid-cols-4 gap-2 rounded-3xl bg-brand p-4 text-center text-white md:p-5">
        {[
          [counts.fitted, "Fitted"],
          [counts.stock, "In stock"],
          [counts.retreader, "At retreader"],
          [counts.warranty, "Warranty ending"],
        ].map(([value, label]) => (
          <div key={label}>
            <p className="text-2xl font-extrabold">{value}</p>
            <p className="text-xs text-brand-pale">{label}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 md:grid-cols-[1fr_380px] md:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {form ? <div className="md:hidden">{form}</div> : null}
          <Tabs<Section>
            value={section}
            onChange={setSection}
            options={[
              { id: "buses", label: "By bus" },
              { id: "all", label: "All tyres" },
              { id: "retread", label: `Retread${atRetreader.length ? ` (${atRetreader.length})` : ""}` },
            ]}
          />
          {section !== "retread" && data.buses.some((bus) => bus.busType !== module) ? (
            <label className="flex items-center gap-3 px-1 text-sm font-semibold text-muted">
              <input type="checkbox" className="h-5 w-5" checked={allBuses} onChange={(event) => setAllBuses(event.target.checked)} />
              Show every bus in the company
            </label>
          ) : null}
          {loading ? <p className="text-muted">Loading…</p> : null}

          {section === "buses" ? (
            shownBuses.length === 0 && !loading ? (
              <Empty>Add buses on the Buses page first.</Empty>
            ) : (
              shownBuses.map((bus) => (
                <Card
                  key={bus.id}
                  title={bus.registrationNumber}
                  action={
                    <span className="text-xs text-muted">
                      {data.odometers.has(bus.id) ? `Odometer ${kmText(data.odometers.get(bus.id) ?? 0)}` : "No odometer yet"}
                      {monthCharges.get(bus.id) ? ` · tyres this month ${formatInr(monthCharges.get(bus.id) ?? 0)}` : ""}
                    </span>
                  }
                >
                  <BusTyreMap
                    busId={bus.id}
                    tyres={tyres}
                    odometer={data.odometers.get(bus.id) ?? null}
                    extraSpares={extraSpares[bus.id] ?? 0}
                    readOnly={org.viewOnly}
                    onTyre={(tyre) => router.push(tyreHref(tyre))}
                    onEmpty={(position) => open({ kind: "move", mode: "fit", tyre: null, slot: { busId: bus.id, position } })}
                    onAddSpare={() => setExtraSpares((current) => ({ ...current, [bus.id]: (current[bus.id] ?? 0) + 1 }))}
                  />
                </Card>
              ))
            )
          ) : null}

          {section === "all" ? (
            <>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  className={FIELD}
                  placeholder="Search tyre number, brand or bus"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <select
                  className={`${FIELD} w-auto`}
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as "" | TyreStatus)}
                >
                  <option value="">All</option>
                  {(Object.keys(STATUS_LABELS) as TyreStatus[]).map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </div>
              <Card>
                {listed.length === 0 ? (
                  <p className="text-muted">{tyres.length ? "No tyres match." : "No tyres entered yet. Tap “+ New tyre”."}</p>
                ) : (
                  <div>{listed.map((tyre, index) => tyreRow(tyre, index))}</div>
                )}
              </Card>
            </>
          ) : null}

          {section === "retread" ? (
            <>
              <Card title="At the retreader">
                {atRetreader.length === 0 ? (
                  <p className="text-muted">No tyres at the retreader. Remove a tyre and choose “Send for retread”.</p>
                ) : (
                  <div>
                    {atRetreader.map((tyre, index) =>
                      tyreRow(
                        tyre,
                        index,
                        !org.viewOnly ? (
                          <SmallButton tone="brand" onClick={() => open({ kind: "move", mode: "retread_in", tyre })}>
                            Received back
                          </SmallButton>
                        ) : (
                          <StatusPill status={tyre.status} />
                        ),
                      ),
                    )}
                  </div>
                )}
              </Card>
              <Card title="Retreaded, waiting for a bus">
                {waiting.length === 0 ? (
                  <p className="text-muted">None waiting.</p>
                ) : (
                  <div>
                    {waiting.map((tyre, index) =>
                      tyreRow(
                        tyre,
                        index,
                        <>
                          {tyre.unchargedInr ? (
                            <span className="text-xs font-bold text-muted">{formatInr(tyre.unchargedInr)} to next bus</span>
                          ) : null}
                          {!org.viewOnly ? (
                            <SmallButton tone="brand" onClick={() => open({ kind: "move", mode: "fit", tyre })}>
                              Fit
                            </SmallButton>
                          ) : null}
                        </>,
                      ),
                    )}
                  </div>
                )}
              </Card>
            </>
          ) : null}
        </div>
        <aside className="hidden md:sticky md:top-24 md:flex md:flex-col md:gap-4">
          {form ?? (
            <Card title="How tyre costs work">
              <p className="text-sm text-muted">
                A tyre&apos;s price is charged to the first bus it is fitted on. After a retread, the retread bill is
                charged to the next bus it goes on. The tyre keeps the same number all its life.
              </p>
              <p className="text-sm text-muted">
                Tap an empty spot on a bus to fit a tyre from stock, or tap a tyre to rotate, remove or send it for
                retread.
              </p>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
