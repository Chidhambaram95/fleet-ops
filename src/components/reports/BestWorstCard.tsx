"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { companyBusDays, loadReportData } from "@data/reports/repository";
import { moduleHref, type ModuleId } from "@domain/modules/modules";
import { formatInr, shiftDate, todayInIst } from "@domain/operations/totals";
import {
  BUS_TYPE_LABELS,
  bestAndWorst,
  busProfitLines,
  type BusProfitLine,
  type ReportData,
} from "@domain/reports/build";

type Range = { from: string; to: string };

type CardData = {
  best: BusProfitLine;
  worst: BusProfitLine | null;
  /** Profit of each bus over the same days of last month. */
  lastMonth: Map<string, number>;
  /** Buses that made a loss in each of the last two full months. */
  losing: string[];
  lastMonthLabel: string;
};

const firstOfMonth = (date: string, plusMonths = 0) => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return new Date(Date.UTC(year, month - 1 + plusMonths, 1)).toISOString().slice(0, 10);
};

/** The same days of last month: 1–4 Nov becomes 1–4 Oct (cut at the month's end). */
function sameDaysLastMonth(range: Range): Range {
  const from = firstOfMonth(range.from, -1);
  const lastDay = shiftDate(range.from, -1);
  const to = `${from.slice(0, 8)}${range.to.slice(8, 10)}`;
  return { from, to: to > lastDay ? lastDay : to };
}

const CACHE_MINUTES = 10;

/** The card's figures, kept for a few minutes so going back to Home is quick. */
function cached(key: string): CardSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { at: number; value: CardSnapshot };
    return Date.now() - saved.at < CACHE_MINUTES * 60_000 ? saved.value : null;
  } catch {
    return null;
  }
}

function keep(key: string, value: CardSnapshot) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // Private windows can refuse storage; the card still works without it.
  }
}

/** What the card needs, in a form that can be stored. */
type CardSnapshot = {
  best: BusProfitLine;
  worst: BusProfitLine | null;
  lastMonth: [string, number][];
  losing: string[];
  lastMonthLabel: string;
};

async function loadCard(
  supabase: SupabaseClient,
  organizationId: string,
  module: ModuleId,
): Promise<CardSnapshot | null> {
  const today = todayInIst();
  const thisMonth: Range = { from: firstOfMonth(today), to: today };
  const previous = sameDaysLastMonth(thisMonth);
  const fullMonths: Range[] = [-2, -1].map((months) => ({
    from: firstOfMonth(today, months),
    to: shiftDate(firstOfMonth(today, months + 1), -1),
  }));
  // One load covers all four ranges; days run come from the database for each.
  const wide: Range = { from: fullMonths[0].from, to: today };
  const [data, ...days] = await Promise.all([
    loadReportData(supabase, organizationId, wide, module, { profitOnly: true }),
    companyBusDays(supabase, organizationId, thisMonth),
    companyBusDays(supabase, organizationId, previous),
    companyBusDays(supabase, organizationId, fullMonths[0]),
    companyBusDays(supabase, organizationId, fullMonths[1]),
  ]);
  const linesFor = (range: Range, busDays: ReportData["companyBusDays"]) =>
    busProfitLines({ ...data, companyBusDays: busDays }, { ...range, busId: "", busType: "", renewalDays: 30 }).lines.filter(
      (line) => line.bus.busType === module,
    );
  const now = linesFor(thisMonth, days[0]);
  const pair = bestAndWorst(now);
  if (!pair) return null;
  const before = linesFor(previous, days[1]);
  const [twoBack, oneBack] = [linesFor(fullMonths[0], days[2]), linesFor(fullMonths[1], days[3])];
  const lost = (lines: BusProfitLine[], id: string) => {
    const line = lines.find((item) => item.bus.id === id);
    return !!line && (line.daysRun > 0 || line.moneyIn > 0 || line.shared > 0) && line.profit < 0;
  };
  const losing = now
    .filter((line) => lost(twoBack, line.bus.id) && lost(oneBack, line.bus.id))
    .map((line) => line.bus.registrationNumber);
  const label = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  const lastMonthLabel = `${label.format(new Date(`${previous.from}T00:00:00Z`))}–${label.format(new Date(`${previous.to}T00:00:00Z`))}`;
  return {
    best: pair.best,
    worst: pair.worst,
    lastMonth: before.map((line) => [line.bus.id, line.profit]),
    losing,
    lastMonthLabel,
  };
}

/**
 * Home screen card: this month's most and least profitable bus of the module,
 * after its share of company costs, with the change from the same days last
 * month, and a warning for buses in loss two months running.
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
  const [card, setCard] = useState<CardData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const key = `fleetops:best-worst:${organizationId}:${module}:${todayInIst()}`;
    const show = (snapshot: CardSnapshot | null) => {
      if (cancelled || !snapshot) return;
      setCard({ ...snapshot, lastMonth: new Map(snapshot.lastMonth) });
    };
    const saved = cached(key);
    if (saved) {
      show(saved);
      return;
    }
    loadCard(supabase, organizationId, module)
      .then((snapshot) => {
        if (snapshot) keep(key, snapshot);
        show(snapshot);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supabase, organizationId, module]);

  if (!card) return null;
  const month = new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "Asia/Kolkata" }).format(new Date());

  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">{card.worst ? "Best & worst bus" : "Your bus this month"}</h2>
          <p className="text-sm text-muted">{month} so far · profit after shared costs</p>
        </div>
        <Link
          href={`${moduleHref(module, "reports")}?report=bus_profit`}
          className="shrink-0 text-sm font-bold text-brand"
        >
          All buses ›
        </Link>
      </div>
      {card.losing.length ? (
        <p className="rounded-2xl bg-[#fbe7e3] px-4 py-3 text-sm font-semibold text-money-out">
          ⚠ In loss two months running: {card.losing.join(", ")}
        </p>
      ) : null}
      <BusTile line={card.best} label={card.worst ? "▲ Top bus" : "This month"} last={card.lastMonth.get(card.best.bus.id)} lastLabel={card.lastMonthLabel} />
      {card.worst ? (
        <BusTile line={card.worst} label="▼ Bottom bus" last={card.lastMonth.get(card.worst.bus.id)} lastLabel={card.lastMonthLabel} />
      ) : null}
      <p className="text-xs text-muted">
        Shared costs = this bus&apos;s share of company costs and salaries (EMI, insurance, office, auditor…), split equally across the buses; crew salaries go to the bus they worked on.
      </p>
    </section>
  );
}

function BusTile({
  line,
  label,
  last,
  lastLabel,
}: {
  line: BusProfitLine;
  label: string;
  last: number | undefined;
  lastLabel: string;
}) {
  // Coloured by profit or loss, not by top or bottom.
  const gain = line.profit >= 0;
  const tone = gain ? "text-money-in" : "text-money-out";
  const change = last == null ? null : line.profit - last;
  return (
    <div className={`flex flex-col gap-2 rounded-2xl p-4 ${gain ? "bg-[#e3f4ea]" : "bg-[#fbe7e3]"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase text-muted">{label}</p>
          <p className="truncate font-extrabold">
            {line.bus.registrationNumber}
            <span className="text-sm font-normal text-muted"> · {BUS_TYPE_LABELS[line.bus.busType]}</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className={`text-xl font-extrabold tabular-nums ${tone}`}>{formatInr(line.profit)}</span>
          {change != null ? (
            <p className={`text-xs font-bold ${change >= 0 ? "text-money-in" : "text-money-out"}`}>
              {change >= 0 ? "▲" : "▼"} {formatInr(Math.abs(change))} vs {lastLabel}
            </p>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <Figure label="Money in" value={formatInr(line.moneyIn)} />
        <Figure label="Own costs" value={formatInr(-line.ownCosts)} />
        <Figure label="Shared costs" value={formatInr(-line.shared)} />
      </div>
      <p className="text-xs text-muted">
        Ran {line.daysRun} day{line.daysRun === 1 ? "" : "s"}
        {line.daysOff ? ` · didn't run ${line.daysOff}` : ""}
      </p>
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
