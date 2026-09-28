"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  signInWithEmail,
  signOut,
  signUpWithEmail,
} from "@data/auth/email";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import {
  categoryLabel,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
} from "@domain/operations/catalog";
import {
  displayDate,
  formatInr,
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
        <code className="text-sm">.env.local</code>, then apply the SQL
        migrations.
      </p>
    );
  }

  return <DailyLedgerSession />;
}

function DailyLedgerSession() {
  const client = useMemo(() => createBrowserSupabaseClient(), []);
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    client.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setSession(data.session);
      }
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [client]);

  if (session === undefined) {
    return <p className="px-1 py-6 text-stone-600">Loading today’s ledger…</p>;
  }

  if (!session) {
    return <AuthPanel client={client} />;
  }

  return (
    <DailyLedgerBoard
      client={client}
      email={session.user.email ?? "Signed in"}
    />
  );
}

function DailyLedgerBoard({
  client,
  email,
}: {
  client: SupabaseClient;
  email: string;
}) {
  const repo = useMemo(
    () => createSupabaseOperationsRepository(client),
    [client],
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

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [nextBuses, nextEntries] = await Promise.all([
          repo.listBuses(),
          repo.listEntriesByDate(date),
        ]);
        if (cancelled) {
          return;
        }
        setBuses(nextBuses);
        setEntries(nextEntries);
        setBusId((current) => current || nextBuses[0]?.id || "");
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

    void load();
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

  return (
    <div className="flex flex-col gap-5 pb-8">
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="rounded-xl bg-white px-3 text-lg font-semibold shadow-sm"
          onClick={() => setDate((current) => shiftDate(current, -1))}
          aria-label="Previous day"
        >
          ‹
        </button>
        <div className="text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-orange-800">
            Daily cash
          </p>
          <h1 className="text-lg font-semibold">{displayDate(date)}</h1>
        </div>
        <button
          type="button"
          className="rounded-xl bg-white px-3 text-lg font-semibold shadow-sm"
          onClick={() => setDate((current) => shiftDate(current, 1))}
          aria-label="Next day"
        >
          ›
        </button>
      </header>

      <div className="flex items-center justify-between gap-2 text-sm text-stone-600">
        <span className="truncate">{email}</span>
        <button
          type="button"
          className="shrink-0 text-stone-500"
          onClick={() => void signOut(client)}
        >
          Sign out
        </button>
      </div>

      <section className="grid grid-cols-3 gap-2">
        <SummaryCard label="In" value={formatInr(fleetTotals.incomeInr)} />
        <SummaryCard label="Out" value={formatInr(fleetTotals.expenseInr)} />
        <SummaryCard
          label="Net"
          value={formatInr(fleetTotals.netInr)}
          emphasize
        />
      </section>

      {loading ? (
        <p className="text-sm text-stone-600">Fetching buses and cash…</p>
      ) : null}

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
        {!loading && buses.length === 0 ? (
          <p className="rounded-2xl bg-white px-3 py-4 text-stone-600 shadow-sm">
            No buses yet. Apply migration 0002 so the three TN buses are seeded.
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

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

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
          Today’s entries
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

function AuthPanel({ client }: { client: SupabaseClient }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    try {
      if (mode === "signin") {
        await signInWithEmail(client, email.trim(), password);
      } else {
        await signUpWithEmail(client, email.trim(), password);
        setInfo("Account created. Confirm email if your project requires it, then sign in.");
      }
    } catch (authError) {
      setError(messageFromUnknown(authError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-orange-800">
        Daily cash
      </p>
      <h1 className="text-lg font-semibold">Sign in to log collections</h1>
      <p className="text-sm text-stone-600">
        Entries save to your fleet database. Use the same login on phone and desk.
      </p>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Email
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-normal"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Password
        <input
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={6}
          className="rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-normal"
          required
        />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {info ? <p className="text-sm text-stone-700">{info}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="rounded-xl bg-orange-700 px-4 text-base font-semibold text-white disabled:opacity-60"
      >
        {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>
      <button
        type="button"
        className="text-sm text-stone-600"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError("");
          setInfo("");
        }}
      >
        {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
      </button>
    </form>
  );
}

function SummaryCard({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl px-2 py-3 text-center shadow-sm ${
        emphasize ? "bg-stone-900 text-white" : "bg-white"
      }`}
    >
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-tight">{value}</p>
    </div>
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
