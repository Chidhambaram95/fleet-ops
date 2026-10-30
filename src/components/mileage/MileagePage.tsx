"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { addMileageCheck, loadMileage, updateMileageTargets, type MileageData } from "@data/mileage/repository";
import {
  mileageAlertWhatsApp,
  mileageSummary,
  periodRange,
  PERIOD_LABELS,
  type BusMileageView,
  type MileagePeriod,
} from "@domain/mileage/mileage";
import { moduleHref, type ModuleId } from "@domain/modules/modules";
import { formatInr } from "@domain/operations/totals";
import { useOrg } from "@/components/billing/OrgContext";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { ErrorText, FIELD, PageHeader, messageFromUnknown, useLoaded } from "@/components/ui/kit";
import { KmplRing, STATUS_COLOURS, STATUS_LABELS, STATUS_PILLS, StatusDonut, TripChart } from "./MileageCharts";

const PERIODS = Object.keys(PERIOD_LABELS) as MileagePeriod[];

/** Mileage of each bus, problem buses first. Tap a bus for its last trips and what to check. */
export function MileagePage({
  organizationId,
  module,
  isAdmin,
}: {
  organizationId: string;
  module: ModuleId;
  /** Admins set each bus's expected mileage and tank size. */
  isAdmin: boolean;
}) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const { data, loading, error, reload } = useLoaded(
    () => loadMileage(supabase, organizationId, module),
    { buses: [], points: [], checkedKeys: new Set<string>() },
    module,
  );
  return (
    <MileageScreen
      module={module}
      isAdmin={isAdmin}
      data={data}
      loading={loading}
      error={error}
      onCheck={async (view) => {
        for (const alert of view.alerts) {
          await addMileageCheck(supabase, organizationId, { busId: view.bus.id, alertKey: alert.key });
        }
        reload();
      }}
      onSaveTargets={async (busId, targets) => {
        await updateMileageTargets(supabase, organizationId, busId, targets);
        reload();
      }}
    />
  );
}

/** The mileage screen itself, given its data. */
export function MileageScreen({
  module,
  isAdmin,
  data,
  loading,
  error,
  onCheck,
  onSaveTargets,
}: {
  module: ModuleId;
  isAdmin: boolean;
  data: MileageData;
  loading: boolean;
  error: string;
  onCheck: (view: BusMileageView) => Promise<void>;
  onSaveTargets: (busId: string, targets: { targetKmpl: number | null; tankLitres: number | null }) => Promise<void>;
}) {
  const org = useOrg();
  const [period, setPeriod] = useState<MileagePeriod>("this_month");
  const [openId, setOpenId] = useState<string | null>(null);
  const [saving, setSaving] = useState("");
  const [actionError, setActionError] = useState("");

  const summary = useMemo(
    () => mileageSummary({ ...data, ...periodRange(period) }),
    [data, period],
  );
  const needLook = summary.counts.alert + summary.counts.warn;
  // The first problem bus starts open, so the reason is visible at once.
  const shownOpen = openId ?? (summary.buses[0] && summary.buses[0].status !== "ok" && summary.buses[0].status !== "none" ? summary.buses[0].bus.id : null);

  async function markChecked(view: BusMileageView) {
    setSaving(view.bus.id);
    setActionError("");
    try {
      await onCheck(view);
    } catch (saveError) {
      setActionError(messageFromUnknown(saveError));
    } finally {
      setSaving("");
    }
  }

  function sendWhatsApp(view: BusMileageView) {
    const alert = view.alerts[0];
    if (!alert) return;
    const text = mileageAlertWhatsApp({ company: org.name, busNumber: view.bus.registrationNumber, alert });
    window.open(`https://wa.me/${org.whatsappNumber}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader
        title="Mileage"
        hint={module === "town" ? "Km per litre from full-tank diesel entries." : "Km per litre from approved trip sheets."}
        action={
          <label className="flex items-center gap-2 text-sm font-semibold text-muted">
            <span className="sr-only">Period</span>
            <select
              className={`${FIELD} w-auto bg-white`}
              value={period}
              onChange={(event) => setPeriod(event.target.value as MileagePeriod)}
            >
              {PERIODS.map((item) => (
                <option key={item} value={item}>
                  {PERIOD_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
        }
      />
      <ErrorText message={error || actionError} />

      {loading ? (
        <p className="rounded-3xl bg-white px-4 py-6 text-center text-muted">Loading…</p>
      ) : summary.buses.length === 0 ? (
        <p className="rounded-3xl bg-white px-4 py-6 text-center text-muted">Add buses to see their mileage.</p>
      ) : (
        <>
          <section aria-label="Summary" className="flex flex-wrap items-center gap-5 rounded-3xl bg-white p-4 md:p-5">
            <StatusDonut counts={summary.counts} size={124} />
            <div className="flex min-w-[180px] flex-1 flex-col gap-2">
              <p className={`text-xl font-extrabold md:text-2xl ${needLook ? "text-money-out" : ""}`}>
                {needLook === 0
                  ? summary.counts.ok
                    ? "All buses are normal"
                    : "No mileage yet"
                  : `${needLook} ${needLook === 1 ? "bus needs" : "buses need"} a look`}
              </p>
              {summary.lostInr > 0 ? (
                <p className="text-sm text-muted">
                  Diesel lost to low mileage, {PERIOD_LABELS[period].toLowerCase()}:{" "}
                  <b className="text-warn-ink">{formatInr(summary.lostInr)}</b> ({summary.lostLitres} L)
                </p>
              ) : null}
              {module === "town" && summary.counts.none === summary.buses.length ? (
                <p className="text-sm text-muted">
                  On a diesel entry, tick &ldquo;Filled to full&rdquo; and enter the odometer and litres. Mileage shows
                  from the second full tank.
                </p>
              ) : null}
            </div>
          </section>

          <section aria-label="Buses" className="flex flex-col gap-2.5">
            {summary.buses.map((view) => {
              const expanded = shownOpen === view.bus.id;
              const canCheck = view.alerts.length > 0 && !org.viewOnly;
              return (
                <article
                  key={view.bus.id}
                  className={`overflow-hidden rounded-3xl border-2 bg-white ${
                    view.status === "alert"
                      ? "border-[#f2c9bf]"
                      : view.status === "warn"
                        ? "border-[#f5dcae]"
                        : "border-white"
                  }`}
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setOpenId(expanded ? "" : view.bus.id)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left md:gap-4 md:px-4"
                  >
                    <KmplRing kmpl={view.latestKmpl} usual={view.usual} status={view.status} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[15px] font-extrabold">{view.bus.registrationNumber}</span>
                      <span
                        className={`text-[13px] font-semibold ${
                          view.status === "alert" ? "text-money-out" : view.status === "warn" ? "text-warn-ink" : "text-muted"
                        }`}
                      >
                        {view.reason}
                      </span>
                      {view.usual ? (
                        <span className="text-xs text-muted">Usual {view.usual.toFixed(1)} km/L</span>
                      ) : null}
                    </span>
                    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${STATUS_PILLS[view.status]}`}>
                      {STATUS_LABELS[view.status]}
                    </span>
                  </button>
                  {expanded ? (
                    <div className="flex flex-col gap-3 px-3 pb-4 md:px-4">
                      {view.recent.length > 0 ? (
                        <>
                          <div className="w-full max-w-xl">
                            <TripChart
                              recent={view.recent}
                              usual={view.usual}
                              colour={STATUS_COLOURS[view.status === "ok" || view.status === "none" ? "warn" : view.status]}
                              label={`Km per litre for ${view.bus.registrationNumber}, oldest to latest`}
                            />
                          </div>
                          {view.usual ? (
                            <p className="text-xs text-muted">The shaded band is this bus&apos;s normal range.</p>
                          ) : null}
                        </>
                      ) : null}
                      <p className="text-sm leading-relaxed">{view.advice}</p>
                      {view.alerts.length > 1 ? (
                        <ul className="flex flex-col gap-1 text-[13px] text-muted">
                          {view.alerts.slice(1).map((alert) => (
                            <li key={alert.key}>Also: {alert.title}</li>
                          ))}
                        </ul>
                      ) : null}
                      {canCheck ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={saving === view.bus.id}
                            onClick={() => void markChecked(view)}
                            className="h-11 grow rounded-2xl bg-brand px-4 text-sm font-bold text-white disabled:opacity-50 md:grow-0"
                          >
                            {saving === view.bus.id ? "Saving…" : "Mark checked"}
                          </button>
                          <button
                            type="button"
                            onClick={() => sendWhatsApp(view)}
                            className="h-11 grow rounded-2xl bg-canvas px-4 text-sm font-bold text-money-in md:grow-0"
                          >
                            Send on WhatsApp
                          </button>
                          {view.alerts[0]?.tripId ? (
                            <Link
                              href={`${moduleHref(module, "trips")}/${view.alerts[0].tripId}`}
                              className="flex h-11 grow items-center justify-center rounded-2xl bg-canvas px-4 text-sm font-bold text-brand md:grow-0"
                            >
                              Open trip sheet
                            </Link>
                          ) : null}
                        </div>
                      ) : null}
                      {isAdmin && !org.viewOnly ? (
                        <BusTargets
                          key={`${view.bus.id}:${view.bus.targetKmpl}:${view.bus.tankLitres}`}
                          view={view}
                          onSave={(targets) => onSaveTargets(view.bus.id, targets)}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}

/** Admin: the bus's own expected km per litre (used instead of its usual) and tank size (for the overfill check). */
function BusTargets({
  view,
  onSave,
}: {
  view: BusMileageView;
  onSave: (targets: { targetKmpl: number | null; tankLitres: number | null }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(view.bus.targetKmpl?.toString() ?? "");
  const [tank, setTank] = useState(view.bus.tankLitres?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const targetKmpl = target.trim() ? Number(target) : null;
    const tankLitres = tank.trim() ? Number(tank) : null;
    if (targetKmpl != null && !(targetKmpl >= 1 && targetKmpl <= 15)) {
      return setError("Expected mileage should be between 1 and 15 km/L.");
    }
    if (tankLitres != null && !(Number.isInteger(tankLitres) && tankLitres >= 20 && tankLitres <= 1000)) {
      return setError("Tank size should be between 20 and 1000 litres.");
    }
    setSaving(true);
    setError("");
    try {
      await onSave({ targetKmpl, tankLitres });
      setOpen(false);
    } catch (saveError) {
      setError(messageFromUnknown(saveError));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-[13px] font-semibold text-brand">
        {view.bus.targetKmpl || view.bus.tankLitres
          ? `Expected ${view.bus.targetKmpl ?? "–"} km/L · tank ${view.bus.tankLitres ?? "–"} L · Change`
          : "Set expected mileage and tank size"}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-canvas p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold">
          Expected km/L
          <input
            inputMode="decimal"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder={view.usual ? view.usual.toFixed(1) : "e.g. 4.2"}
            className="h-11 w-full min-w-0 rounded-xl bg-white px-3 text-base"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold">
          Tank size (L)
          <input
            inputMode="numeric"
            value={tank}
            onChange={(event) => setTank(event.target.value)}
            placeholder="e.g. 250"
            className="h-11 w-full min-w-0 rounded-xl bg-white px-3 text-base"
          />
        </label>
      </div>
      <p className="text-xs text-muted">Leave expected empty to use this bus&apos;s own usual from its trips.</p>
      <ErrorText message={error} />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-xl px-4 text-sm font-bold text-muted">
          Cancel
        </button>
      </div>
    </div>
  );
}
