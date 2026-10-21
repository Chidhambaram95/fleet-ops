"use client";

import { useMemo, useState } from "react";
import {
  listCompanyExpenses,
  listCrewPeople,
  listIntercityIncome,
  listSalaryPayments,
} from "@data/money/repository";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { listRenewals } from "@data/renewals/repository";
import { listEntriesBetween } from "@data/reports/repository";
import { listTripsWithLines } from "@data/trips/repository";
import { hasScreen, MODULE_LABELS, type ModuleId } from "@domain/modules/modules";
import { formatInr, shiftDate, todayInIst } from "@domain/operations/totals";
import type { BusKind } from "@domain/operations/types";
import {
  BUS_TYPE_LABELS,
  buildReport,
  reportCsv,
  type Cell,
  type ReportData,
  type ReportFilters,
  type ReportKind,
  type ReportTable,
} from "@domain/reports/build";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { downloadTextFile } from "@/lib/downloadTextFile";
import {
  BusSelect,
  Card,
  ErrorText,
  FIELD,
  LABEL,
  PageHeader,
  SECONDARY,
  Tabs,
  shortDay,
  useLoaded,
} from "@/components/ui/kit";

type Preset =
  | "this_month"
  | "last_month"
  | "three_months"
  | "financial_year"
  | "custom";

const REPORTS: { id: ReportKind; label: string }[] = [
  { id: "pnl", label: "Profit per bus" },
  { id: "trips", label: "Trip sheets" },
  { id: "fuel", label: "Fuel" },
  { id: "expenses", label: "Where the money went" },
  { id: "crew", label: "Crew" },
  { id: "renewals", label: "Documents due" },
];

const PRESETS: { id: Preset; label: string }[] = [
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "three_months", label: "Last 3 months" },
  { id: "financial_year", label: "This financial year" },
  { id: "custom", label: "Pick dates" },
];

/** Date range for a preset, as IST calendar days. */
function presetRange(
  preset: Preset,
  today: string,
): { from: string; to: string } {
  const [year, month] = today.split("-").map(Number);
  const firstOf = (y: number, m: number) => {
    const date = new Date(Date.UTC(y, m - 1, 1));
    return date.toISOString().slice(0, 10);
  };
  switch (preset) {
    case "last_month":
      return {
        from: firstOf(year, month - 1),
        to: shiftDate(firstOf(year, month), -1),
      };
    case "three_months":
      return { from: firstOf(year, month - 2), to: today };
    case "financial_year":
      return { from: firstOf(month >= 4 ? year : year - 1, 4), to: today };
    default:
      return { from: firstOf(year, month), to: today };
  }
}

function show(table: ReportTable, column: number, value: Cell) {
  if (table.moneyColumns.includes(column) && typeof value === "number") return formatInr(value);
  // Dates stay YYYY-MM-DD in the Excel file but read as "13 Oct 2026" on screen.
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? shortDay(value) : String(value);
}

function whatsappText(
  table: ReportTable,
  filters: ReportFilters,
  scope: string,
) {
  const lines = [
    `*${table.title}*`,
    `${shortDay(filters.from)} to ${shortDay(filters.to)} · ${scope}`,
    "",
    ...table.summary.map(
      (item) =>
        `${item.label}: ${item.tone ? formatInr(item.value) : item.value.toLocaleString("en-IN")}`,
    ),
    "",
    ...table.rows
      .slice(0, 20)
      .map(
        (row) =>
          `• ${table.shareColumns
            .map(
              (index) =>
                `${index ? `${table.columns[index]} ` : ""}${show(table, index, row[index])}`,
            )
            .join(" · ")}`,
      ),
  ];
  if (table.rows.length > 20) lines.push(`…and ${table.rows.length - 20} more`);
  return lines.join("\n");
}

/**
 * Reports for one module, or the combined report for the whole company
 * (module null) in the Company area.
 */
export function ReportsPage({
  organizationId,
  module,
  modules,
}: {
  organizationId: string;
  module: ModuleId | null;
  /** The company's modules, for the combined report's bus type filter. */
  modules: ModuleId[];
}) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const today = todayInIst();
  const [kind, setKind] = useState<ReportKind>("pnl");
  const [preset, setPreset] = useState<Preset>("this_month");
  const [range, setRange] = useState(() => presetRange("this_month", today));
  const [busId, setBusId] = useState("");
  const [pickedType, setBusType] = useState<"" | BusKind>("");
  const busType: "" | BusKind = module ?? pickedType;
  // Town buses have no trip sheets.
  const reports = REPORTS.filter((report) => report.id !== "trips" || !module || hasScreen(module, "trips"));
  const [renewalDays, setRenewalDays] = useState<30 | 60 | 90>(30);

  const empty: ReportData = {
    buses: [],
    allBusIds: [],
    people: [],
    entries: [],
    trips: [],
    companyExpenses: [],
    salaries: [],
    intercity: [],
    renewals: [],
  };
  const { data, loading, error } = useLoaded<ReportData>(
    async () => {
      const [
        buses,
        people,
        entries,
        trips,
        companyExpenses,
        salaries,
        intercity,
        renewals,
      ] = await Promise.all([
        createSupabaseOperationsRepository(supabase).listBuses(organizationId),
        listCrewPeople(supabase, organizationId),
        listEntriesBetween(supabase, organizationId, range.from, range.to),
        listTripsWithLines(supabase, organizationId, {
          ...range,
          approvedOnly: true,
          limit: 5000,
        }),
        listCompanyExpenses(supabase, organizationId, range),
        // Salaries count on the day they were paid, so fetch a month either side.
        listSalaryPayments(supabase, organizationId, {
          from: shiftDate(range.from, -62),
          to: shiftDate(range.to, 31),
        }),
        listIntercityIncome(supabase, organizationId, {
          from: range.from,
          to: range.to,
        }),
        listRenewals(supabase, organizationId),
      ]);
      return {
        buses,
        allBusIds: buses.map((bus) => bus.id),
        people,
        entries,
        trips,
        companyExpenses,
        salaries,
        intercity,
        renewals,
      };
    },
    empty,
    `${range.from}:${range.to}`,
  );

  const filters: ReportFilters = { ...range, busId, busType, renewalDays };
  const table = buildReport(kind, data, filters, today);
  const scope = busId
    ? (data.buses.find((bus) => bus.id === busId)?.registrationNumber ??
      "One bus")
    : busType
      ? `${BUS_TYPE_LABELS[busType]} buses`
      : "All buses";
  const types = modules.filter((type) => data.buses.some((bus) => bus.busType === type));
  const pickable = busType ? data.buses.filter((bus) => bus.busType === busType) : data.buses;

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <PageHeader
          title={module ? `${MODULE_LABELS[module]} reports` : "All buses report"}
          hint={
            module
              ? "Pick a report and dates. Share it or save it for Excel."
              : "Every module together. Pick a report and dates."
          }
        />
      </div>
      <div className="print:hidden">
        <Tabs<ReportKind> value={kind} onChange={setKind} options={reports} />
      </div>

      <Card>
        <div className="grid gap-3 md:grid-cols-4 print:hidden">
          {kind === "renewals" ? (
            <label className={LABEL}>
              Due within
              <select
                className={FIELD}
                value={renewalDays}
                onChange={(event) =>
                  setRenewalDays(Number(event.target.value) as 30 | 60 | 90)
                }
              >
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
              </select>
            </label>
          ) : (
            <label className={LABEL}>
              Dates
              <select
                className={FIELD}
                value={preset}
                onChange={(event) => {
                  const next = event.target.value as Preset;
                  setPreset(next);
                  if (next !== "custom") setRange(presetRange(next, today));
                }}
              >
                {PRESETS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {preset === "custom" && kind !== "renewals" ? (
            <>
              <label className={LABEL}>
                From
                <input
                  type="date"
                  className={FIELD}
                  value={range.from}
                  max={range.to}
                  onChange={(event) =>
                    event.target.value &&
                    setRange({ ...range, from: event.target.value })
                  }
                />
              </label>
              <label className={LABEL}>
                To
                <input
                  type="date"
                  className={FIELD}
                  value={range.to}
                  min={range.from}
                  onChange={(event) =>
                    event.target.value &&
                    setRange({ ...range, to: event.target.value })
                  }
                />
              </label>
            </>
          ) : null}
          <label className={LABEL}>
            Bus
            <BusSelect
              buses={pickable}
              value={busId}
              onChange={setBusId}
              allLabel="All buses"
            />
          </label>
          {!module ? (
          <label className={LABEL}>
            Bus type
            <select
              className={FIELD}
              value={busType}
              onChange={(event) => {
                setBusType(event.target.value as "" | BusKind);
                setBusId("");
              }}
            >
              <option value="">All types</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {BUS_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          ) : null}
        </div>

        <div>
          <h2 className="text-lg font-extrabold">{table.title}</h2>
          <p className="text-sm text-muted">
            {kind === "renewals"
              ? `As of ${shortDay(today)}`
              : `${shortDay(range.from)} to ${shortDay(range.to)}`}{" "}
            · {scope}
          </p>
        </div>
        <ErrorText message={error} />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {table.summary.map((item) => (
            <div key={item.label} className="rounded-2xl bg-canvas p-3">
              <p className="text-xs text-muted">{item.label}</p>
              <p
                className={`text-lg font-extrabold ${
                  item.tone === "in"
                    ? "text-money-in"
                    : item.tone === "out"
                      ? "text-money-out"
                      : ""
                }`}
              >
                {item.tone
                  ? formatInr(item.value)
                  : item.value.toLocaleString("en-IN")}
              </p>
            </div>
          ))}
        </div>

        {loading ? (
          <p className="text-muted">Loading…</p>
        ) : table.rows.length === 0 ? (
          <p className="text-muted">Nothing to show for these dates.</p>
        ) : (
          <>
            {/* Phone: one short line per row; the full table is on laptop, in print and in the Excel file. */}
            <div className="flex flex-col md:hidden print:hidden">
              {table.rows.map((row, rowIndex) => (
                <div
                  key={rowIndex}
                  className={`flex flex-col gap-0.5 py-3 ${rowIndex ? "border-t border-line" : ""}`}
                >
                  <p className="font-semibold">{String(row[0])}</p>
                  <p className="text-sm text-muted">
                    {table.shareColumns
                      .filter((index) => index > 0 && row[index] !== "")
                      .map(
                        (index) =>
                          `${table.columns[index]}: ${show(table, index, row[index])}`,
                      )
                      .join(" · ")}
                  </p>
                </div>
              ))}
            </div>
            <div className="-mx-4 hidden overflow-x-auto px-4 md:mx-0 md:block md:px-0 print:block">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    {table.columns.map((column, index) => (
                      <th
                        key={column}
                        className={`border-b border-line px-2 py-2 font-semibold ${index > 0 && typeof table.rows[0][index] === "number" ? "text-right" : ""}`}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-b border-line">
                      {row.map((cell, index) => (
                        <td
                          key={index}
                          className={`px-2 py-2.5 ${typeof cell === "number" ? "text-right tabular-nums" : ""} ${index === 0 ? "font-semibold" : ""} ${
                            table.moneyColumns.includes(index) &&
                            typeof cell === "number" &&
                            cell < 0
                              ? "text-money-out"
                              : ""
                          }`}
                        >
                          {show(table, index, cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {table.total ? (
                  <tfoot>
                    <tr className="font-extrabold">
                      {table.total.map((cell, index) => (
                        <td
                          key={index}
                          className={`px-2 py-2.5 ${typeof cell === "number" ? "text-right tabular-nums" : ""}`}
                        >
                          {show(table, index, cell)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </>
        )}
        {table.notes.map((note) => (
          <p key={note} className="text-xs text-muted">
            {note}
          </p>
        ))}
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 print:hidden">
        <button
          type="button"
          className="h-12 rounded-2xl bg-[#1f8f4e] px-5 text-[15px] font-bold text-white"
          onClick={() =>
            window.open(
              `https://wa.me/?text=${encodeURIComponent(whatsappText(table, filters, scope))}`,
              "_blank",
              "noopener",
            )
          }
        >
          Send report on WhatsApp
        </button>
        <button
          type="button"
          className={SECONDARY}
          onClick={() =>
            downloadTextFile(
              `${table.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${range.from}-to-${range.to}.csv`,
              reportCsv(table, filters),
              "text/csv;charset=utf-8",
            )
          }
        >
          Download Excel file
        </button>
        <button
          type="button"
          className={SECONDARY}
          onClick={() => window.print()}
        >
          Print or save PDF
        </button>
      </div>
    </div>
  );
}
