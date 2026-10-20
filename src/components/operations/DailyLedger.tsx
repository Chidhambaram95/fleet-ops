"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getActiveMembership } from "@data/auth/session";
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
import type { UserRole } from "@domain/rbac/roles";
import { compressReceipt } from "@/lib/compressReceipt";
import { downloadTextFile } from "@/lib/downloadTextFile";
import { useOrg } from "@/components/billing/OrgContext";
import { RenewalsDueCard } from "@/components/renewals/RenewalsDueCard";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { friendlyErrorMessage } from "@domain/platform/errors";

function messageFromUnknown(error: unknown) {
  return friendlyErrorMessage(error);
}

export function DailyLedger() {
  if (!hasPublicSupabaseEnv()) {
    return (
      <p className="rounded-3xl bg-white px-4 py-6 text-muted">
        Add <code className="text-sm">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="text-sm">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
        <code className="text-sm">.env.local</code>.
      </p>
    );
  }

  return <DailyLedgerBoard />;
}

function DailyLedgerBoard() {
  const org = useOrg();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const repo = useMemo(
    () => createSupabaseOperationsRepository(supabase),
    [supabase],
  );
  const [organizationId, setOrganizationId] = useState("");
  const [role, setRole] = useState<UserRole | null>(null);
  const [assignedBusId, setAssignedBusId] = useState("");
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const sideAmountRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const addParam = searchParams.get("add");

  // The + tab and "Add entry" link land here as /?add=income.
  useEffect(() => {
    if (addParam !== "income" && addParam !== "expense") {
      return;
    }
    setKind(addParam);
    setCategory(addParam === "income" ? "ticket_collection" : "diesel");
    if (window.matchMedia("(min-width: 1024px)").matches) {
      sideAmountRef.current?.focus();
    } else {
      setSheetOpen(true);
    }
    router.replace("/", { scroll: false });
  }, [addParam, router]);

  useEffect(() => {
    if (!sheetOpen) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSheetOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sheetOpen]);

  useEffect(() => {
    let cancelled = false;

    async function loadOrganization() {
      try {
        const membership = await getActiveMembership(supabase);
        if (cancelled) {
          return;
        }
        setOrganizationId(membership.organizationId);
        setRole(membership.role);
        if (membership.role === "crew") {
          const assignment = await repo.getCrewAssignment(
            membership.organizationId,
            membership.userId,
          );
          if (cancelled) {
            return;
          }
          const busId = assignment?.busId ?? "";
          setAssignedBusId(busId);
          if (busId) {
            setBusId(busId);
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(messageFromUnknown(loadError));
          setLoading(false);
        }
      }
    }

    void loadOrganization();
    return () => {
      cancelled = true;
    };
  }, [supabase, repo]);

  useEffect(() => {
    if (!organizationId) {
      return;
    }

    let cancelled = false;

    async function loadBuses() {
      try {
        const nextBuses = await repo.listBuses(organizationId);
        if (cancelled) {
          return;
        }
        setBuses(nextBuses);
        setBusId((current) => {
          if (role === "crew") {
            return assignedBusId || current;
          }
          return current || nextBuses[0]?.id || "";
        });
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
  }, [repo, organizationId, role, assignedBusId]);

  useEffect(() => {
    if (!organizationId) {
      return;
    }

    let cancelled = false;

    async function loadEntriesForDate() {
      setLoading(true);
      setError("");
      setEntries([]);
      try {
        const nextEntries = await repo.listEntriesByDate(organizationId, date);
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
  }, [repo, organizationId, date]);

  const fleetTotals = useMemo(() => totalsForEntries(entries), [entries]);
  const busTotals = useMemo(
    () => totalsByBus(buses, entries),
    [buses, entries],
  );
  const categories = kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const crewLocked = role === "crew";
  const visibleBuses = crewLocked
    ? buses.filter((bus) => bus.id === assignedBusId)
    : buses;

  function onKindChange(next: EntryKind) {
    setKind(next);
    setCategory(next === "income" ? "ticket_collection" : "diesel");
  }

  function openSheet(next: EntryKind) {
    onKindChange(next);
    setError("");
    setSheetOpen(true);
  }

  async function saveEntry() {
    const amountInr = Math.round(Number(amount));
    if (!organizationId) {
      setError("You are not a member of an organization.");
      return;
    }
    if (!busId || (role === "crew" && busId !== assignedBusId)) {
      setError(
        role === "crew"
          ? "You can only log cash for your assigned vehicle."
          : "Pick a bus.",
      );
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
    setSheetOpen(false);
    setEntries((current) => [optimistic, ...current]);
    setAmount("");
    setNote("");

    try {
      const saved = await repo.addEntry(organizationId, {
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
    if (!organizationId) {
      setError("You are not a member of an organization.");
      return;
    }
    const previous = entries;
    setEntries((current) => current.filter((entry) => entry.id !== id));
    setError("");
    try {
      await repo.removeEntry(organizationId, id);
    } catch (removeError) {
      setEntries(previous);
      setError(messageFromUnknown(removeError));
    }
  }

  function downloadCsv() {
    downloadTextFile(
      settlementFilename(date, org.name),
      settlementCsv({ buses, entries }),
      "text/csv;charset=utf-8",
    );
  }

  async function scanReceipt(file: File) {
    setScanning(true);
    setError("");
    try {
      if (!organizationId) {
        setError("You are not a member of an organization.");
        return;
      }
      const image = await compressReceipt(file);
      const response = await fetch("/api/parse-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
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
      setSheetOpen(true);
    } catch (scanError) {
      setError(messageFromUnknown(scanError));
    } finally {
      setScanning(false);
    }
  }

  function sendToOperator() {
    const phone = org.whatsappNumber;
    const url = whatsAppSendUrl({
      text: formatWhatsAppSettlement({ company: org.name, date, buses, entries }),
      phone,
      userAgent: navigator.userAgent,
    });
    window.open(url, "_blank");
  }

  const today = isTodayInIst(date);
  const canWrite = !org.viewOnly;
  const canUndo = (role === "admin" || role === "manager") && canWrite;

  function scanInput() {
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

  function renderForm(place: "sheet" | "side") {
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
          <label className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-pale px-3 text-sm font-bold text-brand active:bg-brand-soft">
            <CameraIcon />
            {scanning ? "Reading the bill…" : "Scan a bill instead"}
            {scanInput()}
          </label>
        ) : null}

        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
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
          <legend className="mb-1.5 text-[13px] font-semibold">For</legend>
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

        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Amount (₹)
          <input
            ref={place === "side" ? sideAmountRef : undefined}
            autoFocus={place === "sheet"}
            inputMode="numeric"
            pattern="[0-9]*"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0"
            className="h-14 rounded-2xl bg-canvas px-4 text-2xl font-bold"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
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
          className="h-14 rounded-2xl bg-brand px-4 text-base font-bold text-white disabled:opacity-50"
        >
          {!canWrite
            ? "View only until payment is received"
            : saving
              ? "Saving…"
              : kind === "income"
                ? "Save money in"
                : "Save money out"}
        </button>
      </form>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-xl font-semibold text-muted"
            onClick={() => setDate((current) => shiftDate(current, -1))}
            aria-label="Previous day"
          >
            ‹
          </button>
          <label className="relative flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-4 sm:flex-none">
            <span aria-hidden="true" className="truncate text-[15px] font-bold">
              {today ? `Today, ${displayDate(date)}` : displayDate(date)}
            </span>
            <CalendarIcon />
            <input
              type="date"
              value={date}
              max={todayInIst()}
              onChange={(event) => {
                if (event.target.value) {
                  setDate(event.target.value);
                }
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Pick a date"
            />
          </label>
          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-xl font-semibold text-muted disabled:opacity-40"
            onClick={() => setDate((current) => shiftDate(current, 1))}
            disabled={today}
            aria-label="Next day"
          >
            ›
          </button>
          {!today ? (
            <button
              type="button"
              className="shrink-0 px-2 text-sm font-bold text-brand"
              onClick={() => setDate(todayInIst())}
            >
              Today
            </button>
          ) : null}
        </div>

        <section className="flex flex-col gap-3.5 rounded-3xl bg-brand p-5 text-white">
          <span className="text-[13px] font-semibold text-brand-pale">
            {today ? "Profit today" : `Profit on ${displayDate(date)}`}
          </span>
          <span className="text-[38px] font-extrabold leading-none tracking-tight">
            {loading ? "…" : formatInr(fleetTotals.netInr)}
          </span>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-2xl bg-brand-mid px-3 py-2.5">
              <div className="text-xs text-brand-pale">Money in</div>
              <div className="text-[17px] font-bold">
                {formatInr(fleetTotals.incomeInr)}
              </div>
            </div>
            <div className="rounded-2xl bg-brand-mid px-3 py-2.5">
              <div className="text-xs text-brand-pale">Money out</div>
              <div className="text-[17px] font-bold">
                {formatInr(fleetTotals.expenseInr)}
              </div>
            </div>
          </div>
        </section>

        {canWrite ? (
          <div className="flex flex-col gap-2.5 lg:hidden">
            <label className="flex min-h-16 cursor-pointer items-center justify-center gap-3 rounded-3xl bg-white px-4 text-base font-bold text-brand shadow-[0_1px_0_rgba(26,27,46,0.04)] active:bg-brand-soft">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-soft">
                <CameraIcon />
              </span>
              {scanning ? "Reading the bill…" : "Scan a bill"}
              {scanInput()}
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => openSheet("income")}
                className="flex min-h-14 items-center justify-center gap-2 rounded-3xl bg-white text-[15px] font-bold text-money-in"
              >
                <ArrowIcon direction="in" />
                Money in
              </button>
              <button
                type="button"
                onClick={() => openSheet("expense")}
                className="flex min-h-14 items-center justify-center gap-2 rounded-3xl bg-white text-[15px] font-bold text-money-out"
              >
                <ArrowIcon direction="out" />
                Money out
              </button>
            </div>
          </div>
        ) : null}

        {organizationId && role && role !== "crew" ? (
          <RenewalsDueCard supabase={supabase} organizationId={organizationId} />
        ) : null}

        {error && !sheetOpen ? (
          <p className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-money-out lg:hidden">
            {error}
          </p>
        ) : null}

        <section className="flex flex-col gap-2.5">
          <h2 className="font-bold">Buses</h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {visibleBuses.map((bus) => {
              const net = busTotals.get(bus.id)?.netInr ?? 0;
              return (
                <div
                  key={bus.id}
                  className="flex min-w-0 flex-col gap-1 rounded-[20px] bg-white p-3.5"
                >
                  <span className="truncate text-xs text-muted">
                    {bus.routeLabel || "No route"}
                  </span>
                  <span className="truncate text-sm font-bold">
                    {bus.registrationNumber}
                  </span>
                  <span
                    className={`text-lg font-extrabold ${
                      net > 0 ? "text-money-in" : net < 0 ? "text-money-out" : "text-ink"
                    }`}
                  >
                    {formatInr(net)}
                  </span>
                </div>
              );
            })}
          </div>
          {loading ? (
            <p className="text-sm text-muted">Loading your buses…</p>
          ) : null}
          {!loading && visibleBuses.length === 0 && !error ? (
            <p className="rounded-[20px] bg-white px-4 py-4 text-muted">
              {crewLocked
                ? "No bus is given to you yet. Ask your admin."
                : "No buses yet."}
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">
              {today ? "Today's entries" : `Entries on ${displayDate(date)}`}
            </h2>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={sendToOperator}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-bold text-money-in disabled:opacity-40"
              >
                <SendIcon />
                Send on WhatsApp
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={downloadCsv}
                aria-label="Download as a file"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-bold text-muted disabled:opacity-40"
              >
                <DownloadIcon />
                <span className="hidden sm:inline">Download</span>
              </button>
            </div>
          </div>
          {entries.length === 0 ? (
            <p className="rounded-[20px] bg-white px-4 py-4 text-muted">
              Nothing added yet. Add the first ticket money or diesel bill.
            </p>
          ) : (
            <div className="rounded-[20px] bg-white px-4 py-1">
              {entries.map((entry, index) => {
                const bus = buses.find((item) => item.id === entry.busId);
                return (
                  <article
                    key={entry.id}
                    className={`flex items-center justify-between gap-3 py-3 ${
                      index > 0 ? "border-t border-line" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {categoryLabel(entry.kind, entry.category)}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {bus?.registrationNumber}
                        {entry.note ? ` · ${entry.note}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span
                        className={`font-bold ${
                          entry.kind === "income" ? "text-money-in" : "text-money-out"
                        }`}
                      >
                        {entry.kind === "income" ? "+" : "−"}
                        {formatInr(entry.amountInr)}
                      </span>
                      {canUndo ? (
                        <button
                          type="button"
                          className="px-2 text-[13px] font-semibold text-muted"
                          onClick={() => void removeEntry(entry.id)}
                        >
                          Undo
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <aside className="hidden flex-col gap-4 rounded-3xl bg-white p-5 lg:sticky lg:top-24 lg:flex">
        <h2 className="text-lg font-extrabold">New entry</h2>
        {renderForm("side")}
      </aside>

      {sheetOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-ink/45 lg:hidden">
          <button
            type="button"
            aria-label="Close"
            className="flex-1"
            onClick={() => setSheetOpen(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label="New entry"
            className="mx-auto flex max-h-[90dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-[28px] bg-white px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold">New entry</h2>
              <button
                type="button"
                className="px-2 text-sm font-bold text-brand"
                onClick={() => setSheetOpen(false)}
              >
                Cancel
              </button>
            </div>
            {renderForm("sheet")}
          </section>
        </div>
      ) : null}
    </div>
  );
}

const FIELD = "h-12 rounded-2xl bg-canvas px-4 text-base";

function CameraIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}

function ArrowIcon({ direction }: { direction: "in" | "out" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {direction === "in" ? (
        <path d="M17 7 7 17M7 9v8h8" />
      ) : (
        <path d="M7 17 17 7M9 7h8v8" />
      )}
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0 text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M3 10h18" />
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
      aria-pressed={active}
      onClick={onClick}
      className={`h-11 rounded-full text-sm font-bold ${
        active
          ? "bg-white text-ink shadow-[0_1px_3px_rgba(26,27,46,0.15)]"
          : "text-muted"
      }`}
    >
      {children}
    </button>
  );
}
