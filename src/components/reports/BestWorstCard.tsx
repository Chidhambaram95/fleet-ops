"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadReportData } from "@data/reports/repository";
import { moduleHref, type ModuleId } from "@domain/modules/modules";
import { formatInr, todayInIst } from "@domain/operations/totals";
import { BUS_TYPE_LABELS, bestAndWorst, busProfitLines, type BusProfitLine } from "@domain/reports/build";

type Pair = NonNullable<ReturnType<typeof bestAndWorst>>;

/**
 * Home screen card: this month's most and least profitable bus of the module,
 * after its share of company costs. Hidden until a bus has run this month.
 */
export function BestWorstCard({
  supabase,
  organizationId,
  module,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  module: ModuleId;
}) {
  const [pair, setPair] = useState<Pair | null>(null);

  useEffect(() => {
    let cancelled = false;
    const today = todayInIst();
    const range = { from: `${today.slice(0, 7)}-01`, to: today };
    loadReportData(supabase, organizationId, range, module)
      .then((data) => {
        if (cancelled) return;
        // Shares are worked out over the whole company, then this module's buses are compared.
        const { lines } = busProfitLines(data, { ...range, busId: "", busType: "", renewalDays: 30 });
        setPair(bestAndWorst(lines.filter((line) => line.bus.busType === module)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supabase, organizationId, module]);

  if (!pair) return null;
  const month = new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "Asia/Kolkata" }).format(new Date());

  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">Best &amp; worst bus</h2>
          <p className="text-sm text-muted">{month} so far · profit after shared costs</p>
        </div>
        <Link
          href={`${moduleHref(module, "reports")}?report=bus_profit`}
          className="shrink-0 text-sm font-bold text-brand"
        >
          All buses ›
        </Link>
      </div>
      <BusTile line={pair.best} top />
      {pair.worst ? <BusTile line={pair.worst} top={false} /> : null}
      <p className="text-xs text-muted">
        Shared costs = this bus&apos;s share of company costs and salaries (EMI, insurance, auditor…), split by days run.
      </p>
    </section>
  );
}

function BusTile({ line, top }: { line: BusProfitLine; top: boolean }) {
  const tone = line.profit >= 0 ? "text-money-in" : "text-money-out";
  return (
    <div className={`flex flex-col gap-2 rounded-2xl p-4 ${top ? "bg-[#e3f4ea]" : "bg-[#fbe7e3]"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-xs font-extrabold uppercase ${top ? "text-money-in" : "text-money-out"}`}>
            {top ? "▲ Top bus" : "▼ Bottom bus"}
          </p>
          <p className="truncate font-extrabold">
            {line.bus.registrationNumber}
            <span className="text-sm font-normal text-muted"> · {BUS_TYPE_LABELS[line.bus.busType]}</span>
          </p>
        </div>
        <span className={`shrink-0 text-xl font-extrabold tabular-nums ${tone}`}>{formatInr(line.profit)}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <Figure label="Money in" value={formatInr(line.moneyIn)} />
        <Figure label="Own costs" value={formatInr(-line.ownCosts)} />
        <Figure label="Shared costs" value={formatInr(-line.shared)} />
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p className="truncate font-bold tabular-nums">{value}</p>
    </div>
  );
}
