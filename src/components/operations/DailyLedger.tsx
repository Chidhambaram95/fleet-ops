"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import {
  categoryLabel,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
} from "@domain/operations/catalog";
import {
  formatWhatsAppSettlement,
  settlementCsv,
  settlementFilename,
  whatsAppSendUrl,
} from "@domain/operations/settlementExport";
import { expenseFromReceipt, receiptSchema } from "@domain/operations/receipt";
import {
  displayDate,
  formatInr,
  isTodayInIst,
  shiftDate,
  todayInIst,
  totalsByBus,
  totalsForEntries,
} from "@domain/operations/totals";
import type {
  Bus,
  DailyEntry,
  EntryKind,
  ExpenseCategory,
  IncomeCategory,
} from "@domain/operations/types";
import { compressReceipt } from "@/lib/compressReceipt";
import { downloadTextFile } from "@/lib/downloadTextFile";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

function messageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function DailyLedger() {
  if (!hasPublicSupabaseEnv()) {
    return (
      <p className="rounded-2xl bg-white px-4 py-6 text-stone-700 shadow-sm">
        Add <code className="text-sm">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="text-sm">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
        <code className="text-sm">.env.local</code>.
      </p>
    );
  }

  return <DailyLedgerBoard />;
}

function DailyLedgerBoard() {
  const repo = useMemo(
    () => createSupabaseOperationsRepository(createBrowserSupabaseClient()),
    [],
  );
  const [date, setDate] = useState(todayInIst);
  const [kind, setKind] = useState<EntryKind>("income");
  const [busId, setBusId] = useState("");
  const [category, setCategory] = useState<string>("ticket_collection");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [buses, setBuses] = useState<Bus[]>([]);
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadBuses() {
      try {
        const nextBuses = await repo.listBuses();
        if (cancelled) {
          return;
        }
        setBuses(nextBuses);
        setBusId((current) => current || nextBuses[0]?.id || "");
      } catch (loadError) {
        if (!cancelled) {
          setError(messageFromUnknown(loadError));
        }
      }
    }

    void loadBuses();
    return () => {
      cancelled = true;
    };
  }, [repo]);

  useEffect(() => {
    let cancelled = false;

    async function loadEntriesForDate() {
      setLoading(true);
      setError("");
      setEntries([]);
      try {
        const nextEntries = await repo.listEntriesByDate(date);
        if (cancelled) {
          return;
        }
        setEntries(nextEntries);
      } catch (loadError) {
        if (!cancelled) {
          setError(messageFromUnknown(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadEntriesForDate();
    return () => {
      cancelled = true;
    };
  }, [repo, date]);

  const fleetTotals = useMemo(() => totalsForEntries(entries), [entries]);
  const busTotals = useMemo(
    () => totalsByBus(buses, entries),
    [buses, entries],
  );
  const categories = kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  function onKindChange(next: EntryKind) {
    setKind(next);
    setCategory(next === "income" ? "ticket_collection" : "diesel");
  }

  async function saveEntry() {
    const amountInr = Math.round(Number(amount));
    if (!busId) {
      setError("Pick a bus.");
      return;
    }
    if (!Number.isFinite(amountInr) || amountInr <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }

    const optimistic: DailyEntry = {
      id: `optimistic-${crypto.randomUUID()}`,
      busId,
      date,
      kind,
      category: category as IncomeCategory | ExpenseCategory,
      amountInr,
      note: note.trim(),
      createdAt: new Date().toISOString(),
    };

    setSaving(true);
    setError("");
    setEntries((current) => [optimistic, ...current]);
    setAmount("");
    setNote("");

    try {
      const saved = await repo.addEntry({
        busId,
        date,
        kind,
        category: optimistic.category,
        amountInr,
        note: optimistic.note,
      });
      setEntries((current) =>
        current.map((entry) => (entry.id === optimistic.id ? saved : entry)),
      );
    } catch (saveError) {
      setEntries((current) =>
        current.filter((entry) => entry.id !== optimistic.id),
      );
      setError(messageFromUnknown(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry(id: string) {
    const previous = entries;
    setEntries((current) => current.filter((entry) => entry.id !== id));
    setError("");
    try {
      await repo.removeEntry(id);
    } catch (removeError) {
      setEntries(previous);
      setError(messageFromUnknown(removeError));
    }
  }

  const netTone =
    fleetTotals.netInr > 0
      ? "positive"
      : fleetTotals.netInr < 0
        ? "negative"
        : "neutral";

  function downloadCsv() {
    downloadTextFile(
      settlementFilename(date),
      settlementCsv({ buses, entries }),
      "text/csv;charset=utf-8",
    );
  }

  async function scanReceipt(file: File) {
    setScanning(true);
    setError("");
    try {
      const image = await compressReceipt(file);
      const response = await fetch("/api/parse-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: image.base64,
          mediaType: image.mediaType,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Could not read that receipt.";
        setError(message);
        return;
      }
      const parsed = receiptSchema.safeParse(payload);
      if (!parsed.success) {
        setError("The receipt reading did not match the expected fields.");
        return;
      }
      const expense = expenseFromReceipt(parsed.data);
      if (Number(expense.amount) <= 0) {
        setError("The receipt amount was not a usable rupee value.");
        return;
      }
      setKind("expense");
      setCategory(expense.category);
      setAmount(expense.amount);
      setNote(expense.note);
      if (expense.date <= todayInIst()) {
        setDate(expense.date);
      }
    } catch (scanError) {
      setError(messageFromUnknown(scanError));
    } finally {
      setScanning(false);
    }
  }

  function sendToOperator() {
    const phone = process.env.NEXT_PUBLIC_MANAGER_PHONE ?? "";
    const url = whatsAppSendUrl({
      text: formatWhatsAppSettlement({ date, buses, entries }),
      phone,
      userAgent: navigator.userAgent,
    });
    window.open(url, "_blank");
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      <section className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-800">
          Daily summary
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-stone-50 text-xl font-semibold text-stone-800"
            onClick={() => setDate((current) => shiftDate(current, -1))}
            aria-label="Previous day"
          >
            ‹
          </button>
          <label className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="text-lg font-semibold tracking-tight text-stone-900">
              {displayDate(date)}
            </span>
            <input
              type="date"
              value={date}
              max={todayInIst()}
              onChange={(event) => {
                if (event.target.value) {
                  setDate(event.target.value);
                }
              }}
              className="h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-center text-sm font-medium text-stone-700"
              aria-label="Select date"
            />
          </label>
          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-stone-50 text-xl font-semibold text-stone-800 disabled:opacity-40"
            onClick={() => setDate((current) => shiftDate(current, 1))}
            disabled={isTodayInIst(date)}
            aria-label="Next day"
          >
            ›
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={downloadCsv}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-stone-50 px-2 py-2 text-center text-[11px] font-semibold leading-tight text-stone-800 active:bg-stone-200 disabled:opacity-40"
          >
            <DownloadIcon />
            Download CSV
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={sendToOperator}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2 text-center text-[11px] font-semibold leading-tight text-emerald-950 active:bg-emerald-100 disabled:opacity-40"
          >
            <SendIcon />
            Send to operator
          </button>
        </div>
        {!isTodayInIst(date) ? (
          <button
            type="button"
            className="mt-2 w-full text-sm font-medium text-orange-800"
            onClick={() => setDate(todayInIst())}
          >
            Jump to today
          </button>
        ) : null}
      </section>

      <section className="grid grid-cols-3 gap-2">
        <SummaryCard
          label="Total Income"
          value={formatInr(fleetTotals.incomeInr)}
          tone="income"
        />
        <SummaryCard
          label="Total Expense"
          value={formatInr(fleetTotals.expenseInr)}
          tone="expense"
        />
        <SummaryCard
          label="Net Profit"
          value={formatInr(fleetTotals.netInr)}
          tone={netTone}
        />
      </section>

      {loading ? (
        <p className="text-sm text-stone-600">Fetching buses and cash…</p>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <section className="flex flex-col gap-2">
        {buses.map((bus) => {
          const totals = busTotals.get(bus.id);
          return (
            <button
              key={bus.id}
              type="button"
              onClick={() => setBusId(bus.id)}
              className={`rounded-2xl border px-3 py-3 text-left shadow-sm ${
                busId === bus.id
                  ? "border-orange-700 bg-orange-50"
                  : "border-transparent bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{bus.registrationNumber}</p>
                  <p className="text-sm text-stone-600">{bus.routeLabel}</p>
                </div>
                <p className="text-sm font-medium">
                  {formatInr(totals?.netInr ?? 0)}
                </p>
              </div>
            </button>
          );
        })}
        {!loading && buses.length === 0 && !error ? (
          <p className="rounded-2xl bg-white px-3 py-4 text-stone-600 shadow-sm">
            No buses yet. Confirm the buses table is seeded in Supabase.
          </p>
        ) : null}
      </section>

      <form
        className="flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void saveEntry();
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <KindButton
            active={kind === "income"}
            onClick={() => onKindChange("income")}
          >
            Income
          </KindButton>
          <KindButton
            active={kind === "expense"}
            onClick={() => onKindChange("expense")}
          >
            Expense
          </KindButton>
        </div>

        {kind === "expense" ? (
          <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm font-semibold text-stone-800 active:bg-stone-200">
            <ScanIcon />
            {scanning ? "Reading receipt…" : "Scan receipt"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={scanning}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) {
                  void scanReceipt(file);
                }
              }}
            />
          </label>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {categories.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCategory(item.id)}
              className={`rounded-full px-3 text-sm ${
                category === item.id
                  ? "bg-stone-900 text-white"
                  : "bg-stone-100 text-stone-800"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Amount (₹)
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0"
            className="rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-normal"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Note (optional)
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Shift, pump, or trip"
            className="rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-normal"
          />
        </label>

        <button
          type="submit"
          disabled={saving || loading || !busId}
          className="rounded-xl bg-orange-700 px-4 text-base font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : `Save ${kind === "income" ? "income" : "expense"}`}
        </button>
      </form>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-600">
          Entries · {displayDate(date)}
        </h2>
        {entries.length === 0 ? (
          <p className="rounded-2xl bg-white px-3 py-4 text-stone-600 shadow-sm">
            No cash logged yet. Add the first collection or diesel bill.
          </p>
        ) : (
          entries.map((entry) => {
            const bus = buses.find((item) => item.id === entry.busId);
            return (
              <article
                key={entry.id}
                className="flex items-start justify-between gap-3 rounded-2xl bg-white px-3 py-3 shadow-sm"
              >
                <div>
                  <p className="font-medium">
                    {entry.kind === "income" ? "+" : "−"}
                    {formatInr(entry.amountInr)}
                  </p>
                  <p className="text-sm text-stone-600">
                    {bus?.registrationNumber} ·{" "}
                    {categoryLabel(entry.kind, entry.category)}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-sm text-stone-500"
                  onClick={() => void removeEntry(entry.id)}
                >
                  Undo
                </button>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "income" | "expense" | "positive" | "negative" | "neutral";
}) {
  const valueClass =
    tone === "income" || tone === "positive"
      ? "text-emerald-700"
      : tone === "expense" || tone === "negative"
        ? "text-red-700"
        : "text-stone-900";

  return (
    <div className="rounded-2xl border border-stone-200 bg-white px-2 py-3 text-center shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
        {label}
      </p>
      <p
        className={`mt-1 text-[13px] font-semibold leading-tight tracking-tight ${valueClass}`}
      >
        {value}
      </p>
    </div>
  );
}

function ScanIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v2" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 2 11 13" />
      <path d="m22 2-7 20-4-9-9-4 20-7z" />
    </svg>
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
      onClick={onClick}
      className={`rounded-xl text-sm font-semibold ${
        active ? "bg-orange-700 text-white" : "bg-stone-100 text-stone-800"
      }`}
    >
      {children}
    </button>
  );
}
