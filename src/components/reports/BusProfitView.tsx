"use client";

import { formatInr } from "@domain/operations/totals";
import { BUS_PROFIT_COLUMNS as C, type BusDetail, type Cell, type ReportTable } from "@domain/reports/build";
import { shortDay } from "@/components/ui/kit";

/** Rupees with paise, such as ₹10.70 or −₹0.72. */
export function formatRate(value: number) {
  const text = `₹${Math.abs(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return value < 0 ? `−${text}` : text;
}

/** Green for a profit, red for a loss. */
export function toneClass(value: Cell) {
  if (typeof value !== "number" || value === 0) return "";
  return value > 0 ? "text-money-in" : "text-money-out";
}

const money = (value: Cell) => (typeof value === "number" ? formatInr(value) : String(value));

/** Short WhatsApp text for Profit by bus: one line per bus, then the total. */
export function busProfitWhatsapp(table: ReportTable): string[] {
  const line = (row: Cell[]) => {
    const days = typeof row[C.daysRun] === "number" ? ` · ${row[C.daysRun]} days run` : "";
    return `• ${row[C.bus]} ${money(row[C.profit])}${days}`;
  };
  return [
    ...table.rows.slice(0, 25).map(line),
    ...(table.rows.length > 25 ? [`…and ${table.rows.length - 25} more`] : []),
    ...(table.total ? ["", `*${table.total[C.bus]}: ${money(table.total[C.profit])}*`] : []),
  ];
}

/** Phone view of Profit by bus: one card per bus. Tapping a bus opens its breakdown. */
export function BusProfitCards({
  table,
  onOpen,
}: {
  table: ReportTable;
  onOpen: (rowIndex: number) => void;
}) {
  const line = (label: string, value: string, valueClass = "") => (
    <div className="flex items-center justify-between gap-3 text-sm text-muted">
      <span>{label}</span>
      <span className={`tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
  const card = (row: Cell[], key: string | number, rowIndex: number | null) => {
    const perKm = row[C.perKm];
    const rate = typeof perKm === "number" ? `${formatRate(perKm)}/km` : "";
    const detail = rowIndex == null ? null : table.details?.[rowIndex];
    const days =
      typeof row[C.daysRun] === "number" && detail
        ? `${row[C.daysRun]} of ${detail.rangeDays} days run`
        : "";
    const km = typeof row[C.km] === "number" && row[C.km] ? `${Number(row[C.km]).toLocaleString("en-IN")} km` : "";
    return (
      <div
        key={key}
        className={`flex flex-col gap-2 rounded-2xl p-4 ${rowIndex == null ? "bg-brand-soft" : "bg-canvas"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-extrabold">{String(row[C.bus])}</p>
            <p className="text-xs text-muted">{[row[C.type], km, days].filter(Boolean).join(" · ")}</p>
          </div>
          {rate ? <span className="shrink-0 text-xs text-muted">{rate}</span> : null}
        </div>
        {line("Bus profit, before company costs", money(row[C.busProfit]))}
        {line("Shared costs", money(row[C.shared]), `font-semibold ${toneClass(row[C.shared])}`)}
        <div className="flex items-center justify-between gap-3 pt-1 font-extrabold">
          <span>Profit</span>
          <span className={`tabular-nums ${toneClass(row[C.profit])}`}>{money(row[C.profit])}</span>
        </div>
        {detail ? (
          <button
            type="button"
            onClick={() => onOpen(rowIndex!)}
            className="self-start text-sm font-bold text-brand"
          >
            See breakdown ›
          </button>
        ) : null}
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-3 md:hidden print:hidden">
      {table.rows.map((row, index) => card(row, index, index))}
      {table.total ? card(table.total, "total", null) : null}
    </div>
  );
}

const GROUP_LABELS = { fixed: "Fixed costs (EMI, insurance, permit)", overhead: "Company overheads", salary: "Crew salaries" };

/** What is behind one bus's figures: days, own costs and each shared cost. */
export function BusDetailPanel({ detail, onClose }: { detail: BusDetail; onClose: () => void }) {
  const row = (label: string, value: number, strong = false) => (
    <div className={`flex items-center justify-between gap-3 text-sm ${strong ? "font-extrabold" : ""}`}>
      <span className={strong ? "" : "text-muted"}>{label}</span>
      <span className={`tabular-nums ${strong ? toneClass(value) : ""}`}>{formatInr(value)}</span>
    </div>
  );
  const items = [...detail.sharedItems].sort((a, b) => b.amountInr - a.amountInr);
  return (
    <section
      aria-label={`Breakdown for ${detail.title}`}
      className="flex flex-col gap-3 rounded-2xl bg-white p-4 ring-2 ring-brand print:hidden"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-extrabold">{detail.title}</h3>
          {detail.rangeDays ? (
            <p className="text-sm text-muted">
              Ran {detail.daysRun} of {detail.rangeDays} days · didn&apos;t run {detail.daysOff}
              {detail.offRoadDays ? ` (${detail.offRoadDays} marked off road)` : ""}
            </p>
          ) : null}
        </div>
        <button type="button" onClick={onClose} className="text-sm font-bold text-brand">
          Close ✕
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {row("Money in", detail.moneyIn)}
        {detail.ownParts.ledger ? row("Ledger costs", -detail.ownParts.ledger) : null}
        {detail.ownParts.trips ? row("Trip sheet costs", -detail.ownParts.trips) : null}
        {detail.ownParts.tyres ? row("Tyres", -detail.ownParts.tyres) : null}
        {(["fixed", "overhead", "salary"] as const).map((group) =>
          detail.sharedParts[group] ? <div key={group}>{row(GROUP_LABELS[group], -detail.sharedParts[group])}</div> : null,
        )}
        {row("Profit", detail.profit, true)}
      </div>
      {items.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-bold uppercase text-muted">Shared costs this bus carries</p>
          {items.map((item, index) => (
            <div key={`${item.id}-${index}`} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                {item.label}
                <span className="text-xs text-muted"> · {shortDay(item.date)}</span>
              </span>
              <span className="shrink-0 tabular-nums">{formatInr(-item.amountInr)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
