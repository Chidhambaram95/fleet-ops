"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import {
  DEFAULT_TYRE_LIFE,
  getTyreLifeSettings,
  latestOdometers,
  listScrapSales,
  listTyreEventsBetween,
  listTyres,
  moveTyre,
} from "@data/tyres/repository";
import { moduleHref, type ModuleId } from "@domain/modules/modules";
import { formatInr, todayInIst } from "@domain/operations/totals";
import {
  chargesByBus,
  expectedLifeKm,
  kmSoFar,
  kmText,
  lifeKmSoFar,
  onScrapPile,
  readyToFit,
  shortKm,
  tyreHealth,
  warrantyState,
  whereNow,
} from "@domain/tyres/calc";
import { ROAD_POSITIONS, STATUS_LABELS, positionLabel, spareCount } from "@domain/tyres/catalog";
import type { UserRole } from "@domain/rbac/roles";
import type { Tyre, TyreLifeSettings, TyreScrapSale, TyreStatus } from "@domain/tyres/types";
import { useOrg } from "@/components/billing/OrgContext";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { ChassisView } from "@/components/tyres/ChassisView";
import { MoveForm, TyreForm, type MoveMode } from "@/components/tyres/TyreForms";
import { ScrapSaleForm, ScrapSection } from "@/components/tyres/TyreScrap";
import { TyreSheet } from "@/components/tyres/TyreSheet";
import {
  Card,
  Empty,
  ErrorText,
  FIELD,
  PageHeader,
  PRIMARY,
  SmallButton,
  Tabs,
  messageFromUnknown,
  useLoaded,
} from "@/components/ui/kit";

type Section = "buses" | "all" | "retread" | "scrap";

const STATUS_CLASS: Record<TyreStatus, string> = {
  fitted: "bg-brand-soft text-brand",
  in_stock: "bg-canvas text-ink",
  at_retreader: "bg-warn-bg text-warn-ink",
  scrapped: "bg-line text-muted",
};

export function StatusPill({ status, onPile = false }: { status: TyreStatus; onPile?: boolean }) {
  const pile = onPile && status === "in_stock";
  return (
    <span
      className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${pile ? "bg-[#fbe9e5] text-money-out" : STATUS_CLASS[status]}`}
    >
      {pile ? "Scrap pile" : STATUS_LABELS[status]}
    </span>
  );
}

type Panel =
  | { kind: "new" }
  | { kind: "scrap" }
  | { kind: "move"; mode: MoveMode; tyre: Tyre | null; slot?: { busId: string; position: string } };

type ChassisMode = "view" | "rotate";

export function TyresPage({
  organizationId,
  module,
  role,
}: {
  organizationId: string;
  module: ModuleId;
  role: UserRole | null;
}) {
  const org = useOrg();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const today = todayInIst();
  const monthStart = `${today.slice(0, 8)}01`;
  const { data, loading, error, reload } = useLoaded(
    async () => {
      const [tyres, buses, odometers, monthEvents, settings, scrapSales] = await Promise.all([
        listTyres(supabase, organizationId),
        createSupabaseOperationsRepository(supabase).listBuses(organizationId),
        latestOdometers(supabase, organizationId),
        listTyreEventsBetween(supabase, organizationId, { from: monthStart, to: today }),
        getTyreLifeSettings(supabase, organizationId),
        // The scrap table exists only after migration 0020.
        listScrapSales(supabase, organizationId).catch((): TyreScrapSale[] => []),
      ]);
      return { tyres, buses, odometers, monthEvents, settings, scrapSales };
    },
    {
      tyres: [] as Tyre[],
      buses: [],
      odometers: new Map<string, number>(),
      monthEvents: [],
      settings: DEFAULT_TYRE_LIFE as TyreLifeSettings,
      scrapSales: [] as TyreScrapSale[],
    },
  );

  const [section, setSection] = useState<Section>("buses");
  const [allBuses, setAllBuses] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | TyreStatus>("");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [extraSpares, setExtraSpares] = useState<Record<string, number>>({});
  // The chassis: which bus, view or rotate, the tyre picked and where it goes.
  const [busPick, setBusPick] = useState("");
  const [chassisMode, setChassisMode] = useState<ChassisMode>("view");
  const [picked, setPicked] = useState<string | null>(null);
  const [swapTarget, setSwapTarget] = useState<string | null>(null);
  const [stockPick, setStockPick] = useState("");
  const [rotateOdometer, setRotateOdometer] = useState("");
  const [rotateError, setRotateError] = useState("");
  const [rotating, setRotating] = useState(false);

  // Tyres move between every bus of the company; a module shows its own buses first.
  const moduleBusIds = new Set(data.buses.filter((bus) => bus.busType === module).map((bus) => bus.id));
  const shownBuses = data.buses.filter((bus) => allBuses || moduleBusIds.has(bus.id));
  const busName = (id: string | null) => data.buses.find((bus) => bus.id === id)?.registrationNumber ?? "Bus";
  const odometerOf = (tyre: Tyre) => (tyre.currentBusId ? (data.odometers.get(tyre.currentBusId) ?? null) : null);
  const inModule = (tyre: Tyre) => tyre.status !== "fitted" || moduleBusIds.has(tyre.currentBusId ?? "");

  const tyres = data.tyres;
  const counts = {
    fitted: tyres.filter((tyre) => tyre.status === "fitted").length,
    stock: tyres.filter(readyToFit).length,
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
  const waiting = tyres.filter((tyre) => readyToFit(tyre) && tyre.retreadCount > 0);
  const pile = tyres.filter(onScrapPile).sort((a, b) => a.tyreNumber.localeCompare(b.tyreNumber));
  const inStock = tyres
    .filter(readyToFit)
    .sort((a, b) => a.tyreNumber.localeCompare(b.tyreNumber));
  const tyreHref = (tyre: Tyre) => `${moduleHref(module, "tyres")}/${tyre.id}`;

  const bus = shownBuses.find((item) => item.id === busPick) ?? shownBuses[0] ?? null;
  const busOdometer = bus ? (data.odometers.get(bus.id) ?? null) : null;
  const onBus = bus ? tyres.filter((tyre) => tyre.status === "fitted" && tyre.currentBusId === bus.id) : [];
  const tyreAt = (position: string | null) => onBus.find((tyre) => tyre.currentPosition === position) ?? null;
  const pickedTyre = tyreAt(picked);
  const targetTyre = tyreAt(swapTarget);
  const sheetTyre = chassisMode === "view" && !panel ? pickedTyre : null;

  function busSummary(busId: string) {
    const fitted = tyres.filter((tyre) => tyre.status === "fitted" && tyre.currentBusId === busId);
    const odometer = data.odometers.get(busId) ?? null;
    const watch = fitted.filter(
      (tyre) => tyreHealth(lifeKmSoFar(tyre, odometer), expectedLifeKm(tyre, data.settings)).health !== "good",
    ).length;
    if (watch) return `${watch} to watch`;
    const spots =
      ROAD_POSITIONS.length +
      spareCount(
        fitted.map((tyre) => tyre.currentPosition),
        extraSpares[busId] ?? 0,
      );
    return fitted.length >= spots ? "All fitted" : `${fitted.length} of ${spots} fitted`;
  }

  function clearPick() {
    setPicked(null);
    setSwapTarget(null);
    setRotateError("");
  }

  function chooseBus(id: string) {
    setBusPick(id);
    clearPick();
    setStockPick("");
  }

  function chooseMode(next: ChassisMode) {
    setChassisMode(next);
    setSwapTarget(null);
    setRotateError("");
    setStockPick("");
    if (next === "rotate" && !pickedTyre) setPicked(null);
  }

  function startRotate() {
    setChassisMode("rotate");
    setSwapTarget(null);
    setRotateOdometer(busOdometer != null ? String(busOdometer) : "");
  }

  function pickOnChassis(position: string, tyre: Tyre | null) {
    if (!bus) return;
    if (chassisMode === "rotate") {
      if (!picked || !pickedTyre) {
        if (tyre) {
          setPicked(position);
          setRotateOdometer(busOdometer != null ? String(busOdometer) : "");
        }
        return;
      }
      if (position === picked) return clearPick();
      setSwapTarget(position);
      setRotateError("");
      return;
    }
    if (tyre) {
      setStockPick("");
      setPanel(null);
      setPicked(position === picked ? null : position);
      return;
    }
    setPicked(null);
    const fromStock = inStock.find((item) => item.id === stockPick) ?? null;
    setStockPick("");
    open({ kind: "move", mode: "fit", tyre: fromStock, slot: { busId: bus.id, position } });
  }

  async function saveRotation() {
    if (!pickedTyre || !swapTarget) return;
    const odometer = Number(rotateOdometer.replace(/,/g, "").trim());
    if (!rotateOdometer.trim() || !Number.isInteger(odometer) || odometer < 0) {
      return setRotateError("Enter the odometer reading in km.");
    }
    setRotating(true);
    setRotateError("");
    try {
      await moveTyre(supabase, pickedTyre.id, { kind: "rotated", date: today, position: swapTarget, odometerKm: odometer });
      clearPick();
      setChassisMode("view");
      reload();
    } catch (saveError) {
      setRotateError(messageFromUnknown(saveError));
    } finally {
      setRotating(false);
    }
  }

  function open(next: Panel) {
    setPanel(next);
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function done() {
    setPanel(null);
    clearPick();
    reload();
  }

  const busOptions = data.buses.map((item) => ({ id: item.id, registrationNumber: item.registrationNumber }));
  const form = panel ? (
    panel.kind === "scrap" ? (
      <ScrapSaleForm supabase={supabase} pile={pile} onDone={done} onCancel={() => setPanel(null)} />
    ) : panel.kind === "new" ? (
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
        lifeSettings={data.settings}
        onDone={done}
        onCancel={() => setPanel(null)}
      />
    )
  ) : null;

  const sheet = sheetTyre ? (
    <TyreSheet
      tyre={sheetTyre}
      busName={busName(sheetTyre.currentBusId)}
      odometer={busOdometer}
      settings={data.settings}
      today={today}
      href={tyreHref(sheetTyre)}
      readOnly={org.viewOnly}
      onRotate={startRotate}
      onRemove={() => open({ kind: "move", mode: "remove", tyre: sheetTyre })}
      onRepair={() => open({ kind: "move", mode: "repair", tyre: sheetTyre })}
      onClose={clearPick}
    />
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
      <div className="flex shrink-0 items-center gap-1">
        {actions ?? <StatusPill status={tyre.status} onPile={!!tyre.scrapPileOn} />}
      </div>
    </div>
  );

  const shortOf = (position: string | null) =>
    ROAD_POSITIONS.find((item) => item.id === position)?.short ?? positionLabel(position);

  const rotateBanner =
    chassisMode === "rotate" ? (
      <div className="flex flex-col gap-2 rounded-2xl bg-ink px-4 py-3 text-sm text-white">
        {!pickedTyre ? (
          <p className="font-bold">Tap the tyre you want to move.</p>
        ) : !swapTarget ? (
          <p className="font-bold">
            Moving {shortOf(picked)} {pickedTyre.tyreNumber}. Tap the tyre to swap with, or an empty spot.
          </p>
        ) : (
          <>
            <p className="font-bold">
              {shortOf(picked)} {pickedTyre.tyreNumber} {targetTyre ? "⇄" : "→"} {shortOf(swapTarget)}
              {targetTyre ? ` ${targetTyre.tyreNumber}` : " (empty)"}
            </p>
            <div className="flex items-center gap-2">
              <label className="flex grow items-center gap-2 text-xs text-white/75">
                Odometer
                <input
                  inputMode="numeric"
                  aria-label="Odometer km"
                  className="h-10 w-full min-w-0 rounded-xl bg-white px-3 text-[15px] font-semibold text-ink"
                  value={rotateOdometer}
                  onChange={(event) => setRotateOdometer(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={rotating}
                onClick={() => void saveRotation()}
                className="h-10 rounded-xl bg-white px-4 font-extrabold text-ink disabled:opacity-60"
              >
                {rotating ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}
        {rotateError ? <p className="rounded-xl bg-white px-3 py-2 text-money-out">{rotateError}</p> : null}
      </div>
    ) : null;

  const rack =
    !org.viewOnly && chassisMode === "view" ? (
      <Card
        title={stockPick ? "Now tap an empty wheel" : "In stock · tap a tyre, then an empty wheel"}
        action={<span className="text-xs text-muted">{inStock.length} tyres</span>}
      >
        {inStock.length === 0 && atRetreader.length === 0 ? (
          <p className="text-sm text-muted">No tyres in stock. Tap “+ New tyre” to add one.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {inStock.map((tyre) => (
              <button
                key={tyre.id}
                type="button"
                aria-pressed={stockPick === tyre.id}
                onClick={() => {
                  setPicked(null);
                  setStockPick(stockPick === tyre.id ? "" : tyre.id);
                }}
                className={`min-w-[120px] shrink-0 rounded-2xl px-3 py-2 text-left text-xs ${
                  stockPick === tyre.id ? "bg-brand text-white" : "bg-canvas text-ink"
                }`}
              >
                <b className="block text-sm">{tyre.tyreNumber}</b>
                {[tyre.brand, tyre.retreadCount ? `R${tyre.retreadCount}` : "new"].filter(Boolean).join(" · ")}
                <span className={`block ${stockPick === tyre.id ? "text-white/80" : "text-muted"}`}>
                  {tyre.unchargedInr ? `${formatInr(tyre.unchargedInr)} to next bus` : shortKm(tyre.totalKm)}
                </span>
              </button>
            ))}
            {atRetreader.map((tyre) => (
              <div key={tyre.id} className="min-w-[120px] shrink-0 rounded-2xl bg-warn-bg px-3 py-2 text-xs text-warn-ink">
                <b className="block text-sm">{tyre.tyreNumber}</b>
                At retreader
                <span className="block">{shortKm(tyre.totalKm)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    ) : null;

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
              { id: "scrap", label: `Scrap${pile.length ? ` (${pile.length})` : ""}` },
            ]}
          />
          {(section === "buses" || section === "all") && data.buses.some((item) => item.busType !== module) ? (
            <label className="flex items-center gap-3 px-1 text-sm font-semibold text-muted">
              <input type="checkbox" className="h-5 w-5" checked={allBuses} onChange={(event) => setAllBuses(event.target.checked)} />
              Show every bus in the company
            </label>
          ) : null}
          {loading ? <p className="text-muted">Loading…</p> : null}

          {section === "buses" ? (
            !bus ? (
              loading ? null : <Empty>Add buses on the Buses page first.</Empty>
            ) : (
              <>
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Buses">
                  {shownBuses.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={item.id === bus.id}
                      onClick={() => chooseBus(item.id)}
                      className={`shrink-0 rounded-2xl px-4 py-2 text-left text-sm font-bold ${
                        item.id === bus.id ? "bg-brand text-white" : "bg-white text-ink"
                      }`}
                    >
                      {item.registrationNumber}
                      <small className={`block text-[11px] font-semibold ${item.id === bus.id ? "text-brand-pale" : "text-muted"}`}>
                        {busSummary(item.id)}
                      </small>
                    </button>
                  ))}
                </div>
                <Card>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-lg font-extrabold">{bus.registrationNumber}</p>
                        <p className="text-xs text-muted">
                          {busOdometer != null ? `Odometer ${kmText(busOdometer)}` : "No odometer yet"}
                          {monthCharges.get(bus.id) ? ` · tyres this month ${formatInr(monthCharges.get(bus.id) ?? 0)}` : ""}
                        </p>
                      </div>
                      {!org.viewOnly ? (
                        <div className="flex shrink-0 rounded-2xl bg-canvas p-1" role="group" aria-label="Chassis mode">
                          {(["view", "rotate"] as const).map((item) => (
                            <button
                              key={item}
                              type="button"
                              aria-pressed={chassisMode === item}
                              onClick={() => chooseMode(item)}
                              className={`rounded-xl px-3 py-1.5 text-sm font-bold ${
                                chassisMode === item ? "bg-white text-brand shadow-sm" : "text-muted"
                              }`}
                            >
                              {item === "view" ? "View" : "Rotate"}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {rotateBanner}
                    <ChassisView
                      busId={bus.id}
                      tyres={tyres}
                      odometer={busOdometer}
                      settings={data.settings}
                      extraSpares={extraSpares[bus.id] ?? 0}
                      selected={picked}
                      swapTarget={chassisMode === "rotate" ? swapTarget : null}
                      readOnly={org.viewOnly}
                      onPick={pickOnChassis}
                      onAddSpare={() => setExtraSpares((current) => ({ ...current, [bus.id]: (current[bus.id] ?? 0) + 1 }))}
                    />
                  </div>
                </Card>
                {rack}
                {sheet ? (
                  <div className="md:hidden">
                    <button type="button" aria-label="Close" className="fixed inset-0 z-50 bg-ink/30" onClick={clearPick} />
                    <div
                      role="dialog"
                      aria-label={`Tyre ${sheetTyre?.tyreNumber}`}
                      className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-white px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_20px_rgba(26,27,46,0.15)]"
                    >
                      <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line" />
                      {sheet}
                    </div>
                  </div>
                ) : null}
              </>
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

          {section === "scrap" ? (
            <ScrapSection
              supabase={supabase}
              pile={pile}
              sales={data.scrapSales}
              tyreHref={tyreHref}
              readOnly={org.viewOnly}
              admin={role === "admin"}
              onSell={() => open({ kind: "scrap" })}
              onChanged={reload}
            />
          ) : null}
        </div>
        <aside className="hidden md:sticky md:top-24 md:flex md:flex-col md:gap-4">
          {form ??
            (sheet && section === "buses" ? (
              <Card>{sheet}</Card>
            ) : (
              <Card title="How tyre costs work">
                <p className="text-sm text-muted">
                  A tyre&apos;s price is charged to the first bus it is fitted on. After a retread, the retread bill is
                  charged to the next bus it goes on. The tyre keeps the same number all its life.
                </p>
                <p className="text-sm text-muted">
                  Tap a tyre on the chassis to see its km and warranty. Use Rotate to swap two tyres, or tap a stock tyre
                  and then an empty wheel to fit it.
                </p>
                <p className="text-xs text-muted">
                  Colours: green is fine, amber has used 70% of its expected km ({kmText(data.settings.newLifeKm)} new,{" "}
                  {kmText(data.settings.retreadLifeKm)} after a retread, unless its warranty says otherwise), red 90%.
                </p>
              </Card>
            ))}
        </aside>
      </div>
    </div>
  );
}
