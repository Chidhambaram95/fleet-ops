"use client";

import { kmSoFar, kmText } from "@domain/tyres/calc";
import { ROAD_POSITIONS, positionLabel, sparePosition, spareCount } from "@domain/tyres/catalog";
import type { Tyre } from "@domain/tyres/types";

/**
 * A bus seen from above, front at the top: two front wheels, four rear wheels
 * (outer and inner on each side) and its spares. Tap a tyre to open it, or an
 * empty spot to fit one.
 */
export function BusTyreMap({
  busId,
  tyres,
  odometer,
  extraSpares,
  onTyre,
  onEmpty,
  onAddSpare,
  readOnly,
}: {
  busId: string;
  tyres: Tyre[];
  odometer: number | null;
  extraSpares: number;
  onTyre: (tyre: Tyre) => void;
  onEmpty: (position: string) => void;
  onAddSpare: () => void;
  readOnly: boolean;
}) {
  const onBus = tyres.filter((tyre) => tyre.status === "fitted" && tyre.currentBusId === busId);
  const at = (position: string) => onBus.find((tyre) => tyre.currentPosition === position);
  const spares = spareCount(
    onBus.map((tyre) => tyre.currentPosition),
    extraSpares,
  );

  const wheel = (position: string, short: string) => {
    const tyre = at(position);
    if (tyre) {
      return (
        <button
          key={position}
          type="button"
          onClick={() => onTyre(tyre)}
          title={positionLabel(position)}
          className="flex min-h-16 min-w-0 flex-col justify-center rounded-2xl bg-ink px-2 py-2 text-left text-white"
        >
          <span className="text-[10px] font-semibold text-brand-pale">{short}</span>
          <span className="truncate text-sm font-bold">{tyre.tyreNumber}</span>
          <span className="truncate text-[11px] text-brand-pale">{kmText(kmSoFar(tyre, odometer))}</span>
        </button>
      );
    }
    return (
      <button
        key={position}
        type="button"
        disabled={readOnly}
        onClick={() => onEmpty(position)}
        title={positionLabel(position)}
        className="flex min-h-16 min-w-0 flex-col items-start justify-center rounded-2xl border-2 border-dashed border-brand-pale px-2 py-2 text-left text-muted disabled:opacity-60"
      >
        <span className="text-[10px] font-semibold">{short}</span>
        <span className="text-sm font-bold text-brand">{readOnly ? "Empty" : "+ Fit"}</span>
      </button>
    );
  };

  const [frontLeft, frontRight, rearLeftOuter, rearLeftInner, rearRightInner, rearRightOuter] = ROAD_POSITIONS;
  return (
    <div className="flex flex-col gap-3">
      <div className="relative mx-auto flex w-full max-w-sm flex-col gap-6 rounded-[2rem] bg-canvas px-3 py-4">
        <p className="text-center text-[11px] font-bold uppercase tracking-wide text-muted">Front</p>
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2">
          {wheel(frontLeft.id, frontLeft.short)}
          <span />
          <span />
          {wheel(frontRight.id, frontRight.short)}
        </div>
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2">
          {wheel(rearLeftOuter.id, rearLeftOuter.short)}
          {wheel(rearLeftInner.id, rearLeftInner.short)}
          {wheel(rearRightInner.id, rearRightInner.short)}
          {wheel(rearRightOuter.id, rearRightOuter.short)}
        </div>
        <p className="text-center text-[11px] font-bold uppercase tracking-wide text-muted">Rear</p>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {Array.from({ length: spares }, (_, index) =>
          wheel(sparePosition(index + 1), index === 0 ? "Spare" : `Spare ${index + 1}`),
        )}
        {!readOnly ? (
          <button
            type="button"
            onClick={onAddSpare}
            className="min-h-16 rounded-2xl bg-canvas px-2 text-sm font-bold text-brand"
          >
            + Spare spot
          </button>
        ) : null}
      </div>
    </div>
  );
}
