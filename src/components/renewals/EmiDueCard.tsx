"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmiReminderDays, listLoans } from "@data/loans/repository";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { emiAlertText, emiAlerts, loansForModule, type EmiAlert } from "@domain/loans/emis";
import { moduleHref, type ModuleId } from "@domain/modules/modules";
import { todayInIst } from "@domain/operations/totals";

export type EmiAlertLine = { kind: EmiAlert["kind"]; text: string };

/** EMI alerts for a module's loans, as lines of text. Empty before migration 0027. */
export function useEmiAlerts(
  supabase: SupabaseClient,
  organizationId: string,
  module: ModuleId | null | undefined,
  refreshKey = "",
) {
  const [lines, setLines] = useState<EmiAlertLine[]>([]);
  useEffect(() => {
    if (!organizationId || !module) {
      setLines([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      listLoans(supabase, organizationId, { quiet: true }),
      getEmiReminderDays(supabase, organizationId),
      createSupabaseOperationsRepository(supabase).listBuses(organizationId),
    ])
      .then(([{ loans, emis }, reminderDays, buses]) => {
        if (cancelled) return;
        const byId = new Map(buses.map((bus) => [bus.id, bus]));
        const mine = loansForModule(loans, (id) => byId.get(id)?.busType, module);
        const name = (id: string) => byId.get(id)?.registrationNumber ?? "Bus";
        setLines(
          emiAlerts(mine, emis, todayInIst(), reminderDays).map((alert) => ({
            kind: alert.kind,
            text: emiAlertText(alert, name),
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supabase, organizationId, module, refreshKey]);
  return lines;
}

export const emiHref = (module: ModuleId) => `${moduleHref(module, "renewals")}?section=loans`;

/** Home screen card: EMIs to fund, confirm or chase. Hidden when nothing needs a look. */
export function EmiDueCard({
  supabase,
  organizationId,
  module,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  module: ModuleId;
}) {
  const lines = useEmiAlerts(supabase, organizationId, module);
  if (!lines.length) return null;
  const late = lines.some((line) => line.kind === "overdue");
  return (
    <Link
      href={emiHref(module)}
      className={`flex flex-col gap-2 rounded-3xl p-4 ${late ? "bg-[#fbe7e3] text-money-out" : "bg-warn-bg text-warn-ink"}`}
    >
      <span className="flex items-center justify-between gap-2 font-extrabold">
        <span>
          {late ? "⚠ " : ""}EMI{lines.length === 1 ? "" : "s"} to look at
        </span>
        <span aria-hidden="true">›</span>
      </span>
      {lines.slice(0, 3).map((line, index) => (
        <span key={index} className={`text-sm ${line.kind === "overdue" ? "font-bold" : ""}`}>
          {line.text}
        </span>
      ))}
      {lines.length > 3 ? <span className="text-xs">and {lines.length - 3} more</span> : null}
    </Link>
  );
}
