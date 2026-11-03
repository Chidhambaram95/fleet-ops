import type { SupabaseClient } from "@supabase/supabase-js";
import { mapDailyEntry, type DailyEntryRow } from "@data/operations/mappers";
import type { DailyEntry } from "@domain/operations/types";
import {
  listCompanyExpenses,
  listCrewPeople,
  listIntercityIncome,
  listOdometerReadings,
  listSalaryPayments,
} from "@data/money/repository";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { listRenewals } from "@data/renewals/repository";
import { listBookings, listTourPayments } from "@data/tours/repository";
import { listTripsWithLines } from "@data/trips/repository";
import { listScrapSales, listTyreEventsBetween, listTyres, listWarrantyCredits } from "@data/tyres/repository";
import type { ModuleId } from "@domain/modules/modules";
import { shiftDate } from "@domain/operations/totals";
import type { ReportData } from "@domain/reports/build";

const PAGE = 1000;

/** Daily ledger entries between two dates (inclusive), a page at a time. */
export async function listEntriesBetween(
  client: SupabaseClient,
  organizationId: string,
  from: string,
  to: string,
): Promise<DailyEntry[]> {
  const entries: DailyEntry[] = [];
  for (let start = 0; start < 20 * PAGE; start += PAGE) {
    const { data, error } = await client
      .from("daily_entries")
      .select("id, bus_id, entry_date, kind, category, amount_inr, note, created_at")
      .eq("organization_id", organizationId)
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + PAGE - 1);
    if (error) {
      throw new Error(error.message);
    }
    const rows = (data ?? []) as DailyEntryRow[];
    entries.push(...rows.map(mapDailyEntry));
    if (rows.length < PAGE) break;
  }
  return entries;
}

export const EMPTY_REPORT_DATA: ReportData = {
  buses: [],
  allBusIds: [],
  people: [],
  entries: [],
  trips: [],
  companyExpenses: [],
  salaries: [],
  intercity: [],
  renewals: [],
  tourBookings: [],
  tourPayments: [],
  tyres: [],
  tyreEvents: [],
  scrapSales: [],
  warrantyCredits: [],
  odometers: [],
  companyBusDays: null,
};

/** Days run by every bus (see ReportData.companyBusDays). Null before migration 0025. */
async function companyBusDays(client: SupabaseClient, organizationId: string, range: { from: string; to: string }) {
  const { data, error } = await client.rpc("company_bus_days", {
    p_org: organizationId,
    p_from: range.from,
    p_to: range.to,
  });
  if (error || !Array.isArray(data)) return null;
  return (data as { bus_id: string; bus_type: string; days: number }[]).map((row) => ({
    busId: String(row.bus_id),
    busType: (row.bus_type === "omni" || row.bus_type === "tour" ? row.bus_type : "town") as "town" | "omni" | "tour",
    days: Number(row.days),
  }));
}

/**
 * Everything the reports need for a date range. `module` is the module the
 * report is opened from (null for the whole company); it only skips tour
 * tables that module doesn't use.
 */
export async function loadReportData(
  client: SupabaseClient,
  organizationId: string,
  range: { from: string; to: string },
  module: ModuleId | null,
): Promise<ReportData> {
  const tours = !module || module === "tour";
  const [
    buses,
    people,
    entries,
    trips,
    companyExpenses,
    salaries,
    intercity,
    renewals,
    tourBookings,
    tourPayments,
    tyres,
    tyreEvents,
    scrapSales,
    warrantyCredits,
    odometers,
    busDays,
  ] = await Promise.all([
    createSupabaseOperationsRepository(client).listBuses(organizationId),
    listCrewPeople(client, organizationId),
    listEntriesBetween(client, organizationId, range.from, range.to),
    listTripsWithLines(client, organizationId, { ...range, approvedOnly: true, limit: 5000 }),
    listCompanyExpenses(client, organizationId, range),
    // Salaries count on the day they were paid, so fetch a month either side.
    listSalaryPayments(client, organizationId, { from: shiftDate(range.from, -62), to: shiftDate(range.to, 31) }),
    listIntercityIncome(client, organizationId, range),
    listRenewals(client, organizationId),
    // Tour tables exist only after migration 0016, and only tour companies use them.
    tours ? listBookings(client, organizationId).catch(() => []) : Promise.resolve([]),
    tours ? listTourPayments(client, organizationId).catch(() => []) : Promise.resolve([]),
    // Tyre tables exist only after migration 0017.
    listTyres(client, organizationId).catch(() => []),
    listTyreEventsBetween(client, organizationId, range).catch(() => []),
    // Scrap sales exist only after migration 0020.
    listScrapSales(client, organizationId, range).catch(() => []),
    // Warranty claims exist only after migration 0021.
    listWarrantyCredits(client, organizationId, range).catch(() => []),
    listOdometerReadings(client, organizationId, range),
    companyBusDays(client, organizationId, range),
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
    tourBookings,
    tourPayments,
    tyres,
    tyreEvents,
    scrapSales,
    warrantyCredits,
    odometers,
    companyBusDays: busDays,
  };
}
