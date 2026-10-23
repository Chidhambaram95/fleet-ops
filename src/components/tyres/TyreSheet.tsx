"use client";

import Link from "next/link";
import {
  HEALTH_LABELS,
  currentStintKm,
  expectedLifeKm,
  kmSoFar,
  kmText,
  lifeKmSoFar,
  tyreHealth,
  warrantyEndsOn,
  warrantyState,
  type TyreHealth,
} from "@domain/tyres/calc";
import { ROAD_POSITIONS, positionLabel } from "@domain/tyres/catalog";
import type { Tyre, TyreLifeSettings } from "@domain/tyres/types";
import { HEALTH_COLOURS } from "@/components/tyres/ChassisView";
import { shortDay } from "@/components/ui/kit";

const HEALTH_PILL: Record<TyreHealth, string> = {
  good: "bg-[#e3f2ea] text-money-in",
  watch: "bg-warn-bg text-warn-ink",
  replace: "bg-[#fbe9e5] text-money-out",
};

export function HealthPill({ health }: { health: TyreHealth }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${HEALTH_PILL[health]}`}>
      {HEALTH_LABELS[health]}
    </span>
  );
}

/** Km used in this life against what it should run, as a coloured bar. */
export function LifeBar({ tyre, odometer, settings }: { tyre: Tyre; odometer: number | null; settings: TyreLifeSettings }) {
  const used = lifeKmSoFar(tyre, odometer);
  const expected = expectedLifeKm(tyre, settings);
  const { health, percent } = tyreHealth(used, expected);
  return (
    <div>
      <div className="mb-1.5 flex justify-between gap-2 text-xs text-muted">
        <span>
          {kmText(used)} {tyre.retreadCount ? `since retread ${tyre.retreadCount}` : "run"}
        </span>
        <span>
          {percent}% of {kmText(expected)}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-canvas">
        <i className="block h-full rounded-full" style={{ width: `${Math.min(100, percent)}%`, background: HEALTH_COLOURS[health] }} />
      </div>
    </div>
  );
}

function warrantyText(tyre: Tyre, today: string, km: number): { text: string; tone: "ok" | "warn" | "bad" } | null {
  if (tyre.retreadCount > 0) {
    return tyre.lifeLimitKm
      ? { text: `Retread warranty up to ${kmText(tyre.lifeLimitKm)}.`, tone: "ok" }
      : null;
  }
  const state = warrantyState(tyre, km, today);
  if (state === "none") return null;
  const endsOn = warrantyEndsOn(tyre);
  const limits = [endsOn ? `on ${shortDay(endsOn)}` : "", tyre.warrantyKm ? `at ${kmText(tyre.warrantyKm)}` : ""]
    .filter(Boolean)
    .join(", or ");
  if (state === "over") return { text: "Warranty is over.", tone: "bad" };
  if (state === "ending") return { text: `Warranty ends soon: ${limits}.`, tone: "warn" };
  return { text: `Warranty ends ${limits}.`, tone: "ok" };
}

const BANNER = { ok: "bg-brand-soft text-brand", warn: "bg-warn-bg text-warn-ink", bad: "bg-[#fbe9e5] text-money-out" };

/** What you see after tapping a tyre on the chassis. */
export function TyreSheet({
  tyre,
  busName,
  odometer,
  settings,
  today,
  href,
  readOnly,
  onRotate,
  onRemove,
  onRepair,
  onClose,
}: {
  tyre: Tyre;
  busName: string;
  odometer: number | null;
  settings: TyreLifeSettings;
  today: string;
  href: string;
  readOnly: boolean;
  onRotate: () => void;
  onRemove: () => void;
  onRepair: () => void;
  onClose: () => void;
}) {
  const health = tyreHealth(lifeKmSoFar(tyre, odometer), expectedLifeKm(tyre, settings)).health;
  const km = kmSoFar(tyre, odometer);
  const short = ROAD_POSITIONS.find((item) => item.id === tyre.currentPosition)?.short;
  const warranty = warrantyText(tyre, today, km);
  const stint = currentStintKm(tyre, odometer);
  const act = "flex min-h-12 items-center justify-center rounded-2xl px-2 text-sm font-bold";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">
            {positionLabel(tyre.currentPosition)}
            {short ? ` (${short})` : ""} · {busName}
          </p>
          <p className="text-[22px] font-extrabold">{tyre.tyreNumber}</p>
          <p className="truncate text-xs text-muted">
            {[tyre.brand, tyre.size].filter(Boolean).join(" · ") || "No brand entered"}
            {tyre.fittedOdometerKm != null ? ` · fitted at ${tyre.fittedOdometerKm.toLocaleString("en-IN")} km` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <HealthPill health={health} />
          <button type="button" aria-label="Close" onClick={onClose} className="h-8 w-8 rounded-full bg-canvas text-lg font-bold text-muted">
            ×
          </button>
        </div>
      </div>
      <LifeBar tyre={tyre} odometer={odometer} settings={settings} />
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          [stint == null ? "–" : kmText(stint), "Since last move"],
          [kmText(km), "Total km"],
          [String(tyre.retreadCount), "Retreads"],
        ].map(([value, label]) => (
          <div key={label} className="rounded-2xl bg-canvas px-2 py-2.5">
            <p className="text-sm font-extrabold">{value}</p>
            <p className="text-[11px] text-muted">{label}</p>
          </div>
        ))}
      </div>
      {warranty ? <p className={`rounded-2xl px-4 py-3 text-sm font-semibold ${BANNER[warranty.tone]}`}>{warranty.text}</p> : null}
      <div className={`grid gap-2 ${readOnly ? "grid-cols-1" : "grid-cols-4"}`}>
        {!readOnly ? (
          <>
            <button type="button" className={`${act} bg-brand text-white`} onClick={onRotate}>
              Rotate
            </button>
            <button type="button" className={`${act} bg-canvas text-ink`} onClick={onRemove}>
              Remove
            </button>
            <button type="button" className={`${act} bg-canvas text-ink`} onClick={onRepair}>
              Repair
            </button>
          </>
        ) : null}
        <Link href={href} className={`${act} bg-canvas text-ink`}>
          History
        </Link>
      </div>
    </div>
  );
}
