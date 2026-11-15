"use client";

import { type ReactNode } from "react";
import { CameraIcon } from "@/components/ui/icons";
import type { DayBook } from "./useDayBook";
import type { EntryFormState } from "./useEntryForm";
import { FIELD } from "./styles";

/** The hidden file picker behind "Scan a bill". Put it inside a label. */
export function ScanInput({ book, form }: { book: DayBook; form: EntryFormState }) {
  const { canWrite } = book;
  const { scanning, scanReceipt } = form;
  return (
    <input
      type="file"
      accept="image/*"
      disabled={scanning || !canWrite}
      className="sr-only"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) {
          void scanReceipt(file);
        }
      }}
    />
  );
}

/** The add-entry form. `place` says where it sits: the laptop side panel or the phone sheet. */
export function EntryForm({ book, form, place }: { book: DayBook; form: EntryFormState; place: "sheet" | "side" }) {
  const { org, busId, setBusId, loading, error, dayLocked, odometers, crewLocked, visibleBuses, canWrite } = book;
  const { kind, onKindChange, category, setCategory, amount, setAmount, note, setNote, dieselKm, setDieselKm, dieselLitres, setDieselLitres, fullTank, setFullTank, saving, scanning, sheetOpen, sideAmountRef, categories, saveEntry } = form;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void saveEntry();
      }}
    >
      <div className="grid grid-cols-2 rounded-full bg-canvas p-1">
        <KindButton
          active={kind === "income"}
          onClick={() => onKindChange("income")}
        >
          Money in
        </KindButton>
        <KindButton
          active={kind === "expense"}
          onClick={() => onKindChange("expense")}
        >
          Money out
        </KindButton>
      </div>

      {kind === "expense" ? (
        <label className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand-pale px-3 text-sm font-semibold text-brand active:bg-brand-soft">
          <CameraIcon />
          {scanning ? "Reading the bill…" : "Scan a bill instead"}
          <ScanInput book={book} form={form} />
        </label>
      ) : null}

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Bus
        <select
          value={busId}
          disabled={crewLocked || loading || visibleBuses.length === 0}
          onChange={(event) => setBusId(event.target.value)}
          className={`${FIELD} disabled:opacity-70`}
        >
          {visibleBuses.length === 0 ? (
            <option value="">No bus</option>
          ) : null}
          {visibleBuses.map((bus) => (
            <option key={bus.id} value={bus.id}>
              {bus.registrationNumber}
              {bus.routeLabel ? ` · ${bus.routeLabel}` : ""}
            </option>
          ))}
        </select>
        {crewLocked ? (
          <span className="text-xs font-normal text-muted">
            You can add money only for your own bus.
          </span>
        ) : null}
      </label>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-semibold">For</legend>
        <div className="flex flex-wrap gap-2">
          {categories.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={category === item.id}
              onClick={() => setCategory(item.id)}
              className={`rounded-full px-4 text-sm font-semibold ${
                category === item.id
                  ? "bg-brand text-white"
                  : "bg-canvas text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Amount (₹)
        <input
          ref={place === "side" ? sideAmountRef : undefined}
          autoFocus={place === "sheet"}
          inputMode="numeric"
          pattern="[0-9]*"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0"
          className="h-14 rounded-lg border border-line-strong bg-surface px-4 text-2xl font-semibold"
        />
      </label>

      {kind === "expense" && category === "diesel" ? (
        <fieldset className="flex flex-col gap-3 rounded-lg bg-canvas p-3">
          <legend className="sr-only">For mileage</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold">
              Odometer (km)
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                value={dieselKm}
                onChange={(event) => setDieselKm(event.target.value)}
                placeholder={odometers.get(busId)?.toString() ?? "e.g. 120500"}
                className="h-12 w-full min-w-0 rounded-lg bg-surface px-4 text-base"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold">
              Litres
              <input
                inputMode="decimal"
                value={dieselLitres}
                onChange={(event) => setDieselLitres(event.target.value)}
                placeholder="e.g. 85"
                className="h-12 w-full min-w-0 rounded-lg bg-surface px-4 text-base"
              />
            </label>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={fullTank}
              onChange={(event) => setFullTank(event.target.checked)}
              className="h-5 min-h-0 w-5 accent-brand"
            />
            Filled the tank to full
          </label>
          <span className="text-xs font-normal text-muted">
            Optional. Fill to full and enter the odometer and litres to see this bus&apos;s mileage.
          </span>
        </fieldset>
      ) : null}

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Note (optional)
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Shift, pump or trip"
          className={FIELD}
        />
      </label>

      {error && (place === "side" || sheetOpen) ? (
        <p className="text-sm font-semibold text-money-out">{error}</p>
      ) : null}

      <button
        type="submit"
        disabled={saving || loading || !busId || !canWrite}
        className="h-14 rounded-lg bg-brand px-4 text-base font-semibold text-white disabled:opacity-50"
      >
        {org.viewOnly
          ? "View only until payment is received"
          : dayLocked
            ? "This day is closed"
          : saving
            ? "Saving…"
            : kind === "income"
              ? "Save money in"
              : "Save money out"}
      </button>
    </form>
  );
}

function KindButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-11 rounded-full text-sm font-semibold ${
        active
          ? "bg-surface text-ink shadow-[0_1px_3px_rgba(26,27,46,0.15)]"
          : "text-muted"
      }`}
    >
      {children}
    </button>
  );
}
