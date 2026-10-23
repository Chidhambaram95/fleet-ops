"use client";

import { expectedLifeKm, lifeKmSoFar, shortKm, tyreHealth, type TyreHealth } from "@domain/tyres/calc";
import { ROAD_POSITIONS, positionLabel, sparePosition, spareCount } from "@domain/tyres/catalog";
import type { Tyre, TyreLifeSettings } from "@domain/tyres/types";

/** Colour of the strip at the foot of each tyre. */
export const HEALTH_COLOURS: Record<TyreHealth, string> = {
  good: "#1e6b45",
  watch: "#c98a1b",
  replace: "#a3321c",
};

const RAIL = "#c9ccdc";
const AXLE = "#9fa3bb";
const TYRE_W = 44;
const TYRE_H = 92;

/** Where each road wheel sits on the 360-wide drawing, front at the top. */
const WHEELS: Record<string, { x: number; y: number }> = {
  front_left: { x: 62, y: 118 },
  front_right: { x: 298, y: 118 },
  rear_left_outer: { x: 34, y: 352 },
  rear_left_inner: { x: 96, y: 352 },
  rear_right_inner: { x: 264, y: 352 },
  rear_right_outer: { x: 326, y: 352 },
};

const SHORT: Record<string, string> = Object.fromEntries(ROAD_POSITIONS.map((item) => [item.id, item.short]));

/**
 * A bus chassis seen from above with only its tyres: frame, engine, axles
 * and the spare carrier. Tap a tyre or an empty wheel. In rotate mode the
 * picked tyre and the swap target are outlined and joined by arrows.
 */
export function ChassisView({
  busId,
  tyres,
  odometer,
  settings,
  extraSpares,
  selected,
  swapTarget,
  onPick,
  onAddSpare,
  readOnly,
}: {
  busId: string;
  tyres: Tyre[];
  odometer: number | null;
  settings: TyreLifeSettings;
  extraSpares: number;
  /** Position picked (tyre open, or first tyre in rotate mode). */
  selected: string | null;
  /** Rotate mode: the position it will move to. */
  swapTarget: string | null;
  onPick: (position: string, tyre: Tyre | null) => void;
  onAddSpare: () => void;
  readOnly: boolean;
}) {
  const onBus = tyres.filter((tyre) => tyre.status === "fitted" && tyre.currentBusId === busId);
  const at = (position: string) => onBus.find((tyre) => tyre.currentPosition === position) ?? null;
  const spares = spareCount(
    onBus.map((tyre) => tyre.currentPosition),
    extraSpares,
  );
  // Spares sit in rows of four on the carrier under the rear overhang.
  const spareRows = Math.ceil(spares / 4);
  const carrierTop = 452;
  const height = carrierTop + 26 + spareRows * 44 + 34;

  const healthOf = (tyre: Tyre) => tyreHealth(lifeKmSoFar(tyre, odometer), expectedLifeKm(tyre, settings)).health;

  function outline(x: number, y: number, w: number, h: number, kind: "selected" | "target") {
    return (
      <rect
        x={x - 7}
        y={y - 7}
        width={w + 14}
        height={h + 14}
        rx={20}
        fill="none"
        stroke={kind === "selected" ? "#3a3fb8" : "#c98a1b"}
        strokeWidth={kind === "selected" ? 3.5 : 3}
        strokeDasharray={kind === "target" ? "6 5" : undefined}
      />
    );
  }

  function wheel(position: string) {
    const { x: cx, y: cy } = WHEELS[position];
    const x = cx - TYRE_W / 2;
    const y = cy - TYRE_H / 2;
    const tyre = at(position);
    const label = `${positionLabel(position)}${tyre ? `, tyre ${tyre.tyreNumber}` : ", empty"}`;
    const ring =
      selected === position ? outline(x, y, TYRE_W, TYRE_H, "selected") : swapTarget === position ? outline(x, y, TYRE_W, TYRE_H, "target") : null;
    if (!tyre) {
      return (
        <g
          key={position}
          role="button"
          tabIndex={readOnly ? -1 : 0}
          aria-label={label}
          className={readOnly ? "outline-none" : "cursor-pointer outline-none"}
          onClick={() => !readOnly && onPick(position, null)}
          onKeyDown={(event) => event.key === "Enter" && !readOnly && onPick(position, null)}
        >
          {ring}
          <rect x={x} y={y} width={TYRE_W} height={TYRE_H} rx={14} fill="#fff" stroke="#b9bcd6" strokeWidth={2.5} strokeDasharray="7 6" />
          {!readOnly ? (
            <text x={cx} y={cy + 7} textAnchor="middle" fontSize={22} fontWeight={800} fill="#3a3fb8">
              +
            </text>
          ) : null}
          <text x={cx} y={y + TYRE_H + 16} textAnchor="middle" fontSize={11} fontWeight={800} fill="#1a1b2e">
            {SHORT[position]}
          </text>
          <text x={cx} y={y + TYRE_H + 29} textAnchor="middle" fontSize={9.5} fill="#5b5e7a">
            Empty
          </text>
        </g>
      );
    }
    return (
      <g
        key={position}
        role="button"
        tabIndex={0}
        aria-label={label}
        className="cursor-pointer outline-none"
        onClick={() => onPick(position, tyre)}
        onKeyDown={(event) => event.key === "Enter" && onPick(position, tyre)}
      >
        {ring}
        <rect x={x} y={y} width={TYRE_W} height={TYRE_H} rx={14} fill="#23243a" />
        {Array.from({ length: 7 }, (_, index) => {
          const ty = y + 12 + index * ((TYRE_H - 24) / 6);
          return (
            <path
              key={index}
              d={`M${x + 7} ${ty} l${TYRE_W / 2 - 7} 5 l${TYRE_W / 2 - 7} -5`}
              stroke="rgba(255,255,255,.18)"
              strokeWidth={2.4}
              fill="none"
            />
          );
        })}
        <rect x={x + 4} y={y + TYRE_H - 12} width={TYRE_W - 8} height={7} rx={3.5} fill={HEALTH_COLOURS[healthOf(tyre)]} />
        <text x={cx} y={y + 20} textAnchor="middle" fontSize={10} fontWeight={800} fill="#fff">
          {SHORT[position]}
        </text>
        <text x={cx} y={y + TYRE_H + 16} textAnchor="middle" fontSize={10} fontWeight={800} fill="#1a1b2e">
          {tyre.tyreNumber}
        </text>
        <text x={cx} y={y + TYRE_H + 29} textAnchor="middle" fontSize={9.5} fill="#5b5e7a">
          {shortKm(lifeKmSoFar(tyre, odometer))}
          {tyre.retreadCount ? ` · R${tyre.retreadCount}` : ""}
        </text>
      </g>
    );
  }

  function spare(index: number) {
    const position = sparePosition(index + 1);
    const perRow = Math.min(4, spares - Math.floor(index / 4) * 4);
    const column = index % 4;
    const w = 68;
    const gap = 8;
    const rowWidth = perRow * w + (perRow - 1) * gap;
    const x = 180 - rowWidth / 2 + column * (w + gap);
    const y = carrierTop + 26 + Math.floor(index / 4) * 44;
    const tyre = at(position);
    const ring =
      selected === position ? outline(x, y, w, 32, "selected") : swapTarget === position ? outline(x, y, w, 32, "target") : null;
    const label = `${positionLabel(position)}${tyre ? `, tyre ${tyre.tyreNumber}` : ", empty"}`;
    return (
      <g
        key={position}
        role="button"
        tabIndex={tyre || !readOnly ? 0 : -1}
        aria-label={label}
        className={tyre || !readOnly ? "cursor-pointer outline-none" : "outline-none"}
        onClick={() => (tyre || !readOnly) && onPick(position, tyre)}
        onKeyDown={(event) => event.key === "Enter" && (tyre || !readOnly) && onPick(position, tyre)}
      >
        {ring}
        {tyre ? (
          <>
            <rect x={x} y={y} width={w} height={32} rx={12} fill="#23243a" />
            <rect x={x + 6} y={y + 24} width={w - 12} height={5} rx={2.5} fill={HEALTH_COLOURS[healthOf(tyre)]} />
            <text x={x + w / 2} y={y + 20} textAnchor="middle" fontSize={10} fontWeight={800} fill="#fff">
              {tyre.tyreNumber}
            </text>
          </>
        ) : (
          <>
            <rect x={x} y={y} width={w} height={32} rx={12} fill="#fff" stroke="#b9bcd6" strokeWidth={2} strokeDasharray="6 5" />
            <text x={x + w / 2} y={y + 21} textAnchor="middle" fontSize={11} fontWeight={800} fill="#3a3fb8">
              {readOnly ? "Empty" : "+ Spare"}
            </text>
          </>
        )}
      </g>
    );
  }

  const carrierWidth = Math.min(4, spares) * 76 + 20;
  const arrows = selected && swapTarget ? swapArrows(selected, swapTarget) : null;

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 360 ${height}`}
        className="mx-auto block w-full max-w-[360px] md:max-w-[430px]"
        role="group"
        aria-label="Tyres on this bus, seen from above"
      >
        <text x={180} y={22} textAnchor="middle" fontSize={11} fontWeight={800} letterSpacing={2} fill="#5b5e7a">
          ▲ FRONT
        </text>
        <rect x={128} y={44} width={16} height={420} rx={6} fill={RAIL} />
        <rect x={216} y={44} width={16} height={420} rx={6} fill={RAIL} />
        {[60, 230, 430].map((cy) => (
          <rect key={cy} x={128} y={cy} width={104} height={10} rx={4} fill={RAIL} />
        ))}
        <rect x={152} y={140} width={56} height={58} rx={12} fill="#e6e7fa" stroke="#d9daf6" />
        <text x={180} y={173} textAnchor="middle" fontSize={8.5} fontWeight={800} fill="#4c51c6">
          ENGINE
        </text>
        <rect x={176} y={198} width={8} height={140} rx={4} fill={AXLE} />
        <rect x={62} y={113} width={236} height={10} rx={5} fill={AXLE} />
        <rect x={34} y={347} width={292} height={12} rx={6} fill={AXLE} />
        <ellipse cx={180} cy={353} rx={24} ry={18} fill={AXLE} />
        {Object.keys(WHEELS).map(wheel)}
        <rect
          x={180 - carrierWidth / 2}
          y={carrierTop}
          width={carrierWidth}
          height={height - carrierTop - 34}
          rx={14}
          fill="#fff"
          stroke="#d9daf6"
          strokeWidth={2}
        />
        <text x={180} y={carrierTop + 16} textAnchor="middle" fontSize={9} fontWeight={800} letterSpacing={1} fill="#5b5e7a">
          SPARE
        </text>
        {Array.from({ length: spares }, (_, index) => spare(index))}
        {arrows}
        <text x={180} y={height - 8} textAnchor="middle" fontSize={11} fontWeight={800} letterSpacing={2} fill="#5b5e7a">
          REAR ▼
        </text>
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {(["good", "watch", "replace"] as const).map((health) => (
            <span key={health} className="flex items-center gap-1.5">
              <i className="inline-block h-3 w-3 rounded" style={{ background: HEALTH_COLOURS[health] }} />
              {health === "good" ? "Good" : health === "watch" ? "Watch (70% of life)" : "Replace soon (90%)"}
            </span>
          ))}
        </div>
        {!readOnly ? (
          <button type="button" onClick={onAddSpare} className="text-[13px] font-bold text-brand">
            + Spare spot
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Two curved arrows between the picked tyre and the one it swaps with. */
function swapArrows(from: string, to: string) {
  const point = (position: string) => WHEELS[position] ?? { x: 180, y: 490 };
  const a = point(from);
  const b = point(to);
  const lift = 64;
  return (
    <g pointerEvents="none">
      <defs>
        <marker id="tyre-swap-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="#c98a1b" />
        </marker>
      </defs>
      <path
        d={`M${a.x} ${a.y - TYRE_H / 2 - 10} C ${a.x} ${a.y - TYRE_H / 2 - lift}, ${b.x} ${b.y - TYRE_H / 2 - lift}, ${b.x} ${b.y - TYRE_H / 2 - 12}`}
        fill="none"
        stroke="#c98a1b"
        strokeWidth={3}
        markerEnd="url(#tyre-swap-arrow)"
      />
      <path
        d={`M${b.x} ${b.y + TYRE_H / 2 + 36} C ${b.x} ${b.y + TYRE_H / 2 + 60}, ${a.x} ${a.y + TYRE_H / 2 + 60}, ${a.x} ${a.y + TYRE_H / 2 + 38}`}
        fill="none"
        stroke="#c98a1b"
        strokeWidth={3}
        markerEnd="url(#tyre-swap-arrow)"
      />
    </g>
  );
}
