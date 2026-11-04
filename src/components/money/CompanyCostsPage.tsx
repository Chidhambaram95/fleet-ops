"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import {
  addCompanyExpense,
  updateCompanyExpense,
  deleteRow,
  listCompanyExpenses,
} from "@data/money/repository";
import { COMPANY_EXPENSE_CATEGORIES, PAID_VIA, companyExpenseLabel } from "@domain/money/catalog";
import type { CompanyExpense, CompanyExpenseCategory, CostAppliesTo, PaidVia, SpreadMonths } from "@domain/money/types";
import type { Bus } from "@domain/operations/types";
import { MODULE_LABELS, type ModuleId } from "@domain/modules/modules";
import { formatInr, todayInIst } from "@domain/operations/totals";
import { useOrg } from "@/components/billing/OrgContext";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import {
  Card,
  ErrorText,
  FIELD,
  LABEL,
  ListRow,
  PageHeader,
  PRIMARY,
  SmallButton,
  messageFromUnknown,
  shortDay,
  useLoaded,
  wholeNumber,
} from "@/components/ui/kit";

type AppliesTo = Pick<CompanyExpense, "appliesTo" | "appliesType" | "busIds">;

const plural = (count: number) => `${count} bus${count === 1 ? "" : "es"}`;

/** The buses a choice covers today. */
function coveredBuses(choice: AppliesTo, buses: readonly Bus[]): Bus[] {
  if (choice.appliesTo === "type") return buses.filter((bus) => bus.busType === choice.appliesType);
  if (choice.appliesTo === "buses") return buses.filter((bus) => choice.busIds.includes(bus.id));
  return [...buses];
}

/** Short name of a choice: "All buses (6)", "Town buses (3)" or the registration numbers. */
function appliesLabel(choice: AppliesTo, buses: readonly Bus[]) {
  const covered = coveredBuses(choice, buses);
  if (choice.appliesTo === "type" && choice.appliesType) {
    return `${MODULE_LABELS[choice.appliesType]} buses (${covered.length})`;
  }
  if (choice.appliesTo === "buses") {
    return covered.length ? covered.map((bus) => bus.registrationNumber).join(", ") : "Picked buses";
  }
  return `All buses (${covered.length})`;
}

const CHIP: Record<CostAppliesTo, string> = {
  all: "bg-brand-soft text-brand",
  type: "bg-[#e3f4ea] text-money-in",
  buses: "bg-warn-bg text-warn-ink",
};

/**
 * One dropdown for who a cost applies to: all buses, a bus type, or picked
 * buses. Choosing a type ticks its buses; changing the ticks makes it a
 * custom list.
 */
function AppliesToPicker({
  value,
  onChange,
  buses,
  types,
}: {
  value: AppliesTo;
  onChange: (next: AppliesTo) => void;
  buses: Bus[];
  types: ModuleId[];
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !box.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const ticked = new Set(coveredBuses(value, buses).filter(() => value.appliesTo !== "all").map((bus) => bus.id));
  const toggle = (busId: string) => {
    const next = new Set(ticked);
    if (next.has(busId)) next.delete(busId);
    else next.add(busId);
    const busIds = buses.filter((bus) => next.has(bus.id)).map((bus) => bus.id);
    onChange(busIds.length ? { appliesTo: "buses", appliesType: null, busIds } : { appliesTo: "all", appliesType: null, busIds: [] });
  };
  const option = (selected: boolean) =>
    `flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left ${selected ? "bg-brand-soft font-bold text-brand" : ""}`;
  const radio = (selected: boolean) => (
    <span
      aria-hidden="true"
      className={`grid size-5 shrink-0 place-items-center rounded-full border-2 ${selected ? "border-brand bg-brand text-[11px] text-white" : "border-line bg-white"}`}
    >
      {selected ? "✓" : ""}
    </span>
  );
  const covered = coveredBuses(value, buses);
  // Every bus of one type ticked by hand: a type choice would also cover buses added later.
  const wholeType =
    value.appliesTo === "buses" && types.length > 1
      ? (types.find((type) => {
          const ofType = buses.filter((bus) => bus.busType === type);
          return ofType.length > 0 && ofType.length === covered.length && ofType.every((bus) => ticked.has(bus.id));
        }) ?? null)
      : null;
  const typeName = value.appliesType ? MODULE_LABELS[value.appliesType] : "";

  return (
    <div ref={box} className="relative flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold">Applies to</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
        className={`${FIELD} flex items-center justify-between gap-2 text-left ${open ? "ring-2 ring-brand" : ""}`}
      >
        <span className="truncate">{appliesLabel(value, buses)}</span>
        <span aria-hidden="true" className="text-muted">
          ⌄
        </span>
      </button>
      {open ? (
        // Phone: a sheet from the bottom, above the menu bar. Laptop: a list under the box.
        <button
          type="button"
          aria-label="Close"
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
        />
      ) : null}
      {open ? (
        <div className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col gap-0.5 overflow-y-auto rounded-t-3xl bg-white p-3 pb-0 shadow-xl ring-1 ring-line md:absolute md:inset-x-0 md:top-full md:bottom-auto md:z-20 md:mt-1 md:max-h-[60vh] md:rounded-2xl md:p-2">
          <span className="px-3 pt-1 pb-2 text-base font-extrabold md:hidden">Applies to</span>
          <button
            type="button"
            className={option(value.appliesTo === "all")}
            onClick={() => {
              onChange({ appliesTo: "all", appliesType: null, busIds: [] });
              setOpen(false);
            }}
          >
            {radio(value.appliesTo === "all")}
            <span className="grow">All buses</span>
            <span className="text-xs font-normal text-muted">{plural(buses.length)}</span>
          </button>
          {types.length > 1 ? (
            <>
              <span className="px-3 pt-2 pb-1 text-xs font-bold uppercase text-muted">By bus type</span>
              {types.map((type) => {
                const selected = value.appliesTo === "type" && value.appliesType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    className={option(selected)}
                    onClick={() => {
                      onChange({ appliesTo: "type", appliesType: type, busIds: [] });
                      setOpen(false);
                    }}
                  >
                    {radio(selected)}
                    <span className="grow">{MODULE_LABELS[type]} buses</span>
                    <span className="text-xs font-normal text-muted">
                      {buses.filter((bus) => bus.busType === type).length}
                    </span>
                  </button>
                );
              })}
            </>
          ) : null}
          <span className="px-3 pt-2 pb-1 text-xs font-bold uppercase text-muted">Pick buses (tick one or more)</span>
          {buses.map((bus) => (
            <label key={bus.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3">
              <input
                type="checkbox"
                className="size-5 accent-brand"
                checked={ticked.has(bus.id)}
                onChange={() => toggle(bus.id)}
              />
              <span className="grow font-semibold">{bus.registrationNumber}</span>
              <span className="text-xs text-muted">{MODULE_LABELS[bus.busType]}</span>
            </label>
          ))}
          <div className="sticky bottom-0 -mx-3 mt-1 bg-white px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:-mx-2 md:px-2 md:pb-2">
            <button
              type="button"
              className="h-11 w-full rounded-full bg-brand text-sm font-bold text-white md:h-10 md:bg-canvas md:text-brand"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
      <p className="text-xs text-muted">
        {value.appliesTo === "all"
          ? `Split among all ${plural(buses.length)} in reports, by the days each bus ran.`
          : value.appliesTo === "type"
            ? `Split among the ${covered.length} ${typeName} bus${covered.length === 1 ? "" : "es"} (and any added later), by the days each ran.`
            : covered.length === 1
              ? `Counted against ${covered[0].registrationNumber} only.`
              : `Split among these ${plural(covered.length)} by the days each ran.`}
      </p>
      {wholeType ? (
        <p className="text-xs text-warn-ink">
          All {MODULE_LABELS[wholeType]} buses are ticked. Choose &ldquo;{MODULE_LABELS[wholeType]} buses&rdquo; instead to
          include buses added later.
        </p>
      ) : null}
    </div>
  );
}

/** "Nov 2026" for the month a date falls in, moved on by some months. */
function monthLabel(date: string, plusMonths: number) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1 + plusMonths, 1)),
  );
}

const sameCost = (a: CompanyExpense, b: CompanyExpense) =>
  a.category === b.category &&
  a.amountInr === b.amountInr &&
  a.appliesTo === b.appliesTo &&
  a.appliesType === b.appliesType &&
  a.busIds.join() === b.busIds.join();

/** Repeating costs not yet added this month: the latest of each, once. */
function dueRepeats(expenses: CompanyExpense[], today: string): CompanyExpense[] {
  const month = today.slice(0, 7);
  const due: CompanyExpense[] = [];
  const latestFirst = [...expenses].sort((a, b) => b.spentOn.localeCompare(a.spentOn));
  for (const item of latestFirst) {
    if (!item.repeatMonthly || item.spentOn.slice(0, 7) >= month) continue;
    if (latestFirst.some((other) => other.spentOn.slice(0, 7) === month && sameCost(other, item))) continue;
    if (due.some((other) => sameCost(other, item))) continue;
    due.push(item);
  }
  return due;
}

/**
 * Company area: bank and company costs. Each cost applies to all buses, one
 * bus type, or picked buses, and is shared among them in reports.
 */
export function CompanyCostsPage({
  organizationId,
  modules,
}: {
  organizationId: string;
  /** The company's modules, to group the bus list. */
  modules: ModuleId[];
}) {
  const org = useOrg();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const { data, loading, error, reload } = useLoaded(
    async () => {
      const [expenses, buses] = await Promise.all([
        listCompanyExpenses(supabase, organizationId),
        createSupabaseOperationsRepository(supabase).listBuses(organizationId),
      ]);
      return { expenses, buses };
    },
    { expenses: [], buses: [] },
  );
  const types = modules.filter((module) => data.buses.some((bus) => bus.busType === module));
  // Grouped by type, in the company's module order.
  const sortedBuses = types.flatMap((type) => data.buses.filter((bus) => bus.busType === type));

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [spentOn, setSpentOn] = useState(todayInIst());
  const [category, setCategory] = useState<CompanyExpenseCategory>("workshop");
  const [appliesTo, setAppliesTo] = useState<AppliesTo>({ appliesTo: "all", appliesType: null, busIds: [] });
  const [amount, setAmount] = useState("");
  const [paidVia, setPaidVia] = useState<PaidVia>("bank");
  const [note, setNote] = useState("");
  const [spreadMonths, setSpreadMonths] = useState<SpreadMonths>(1);
  const [repeatMonthly, setRepeatMonthly] = useState(false);
  // The cost being changed, or null when adding a new one.
  const [editingId, setEditingId] = useState<string | null>(null);

  /** Back to an empty form for the next cost: all buses, one month, no repeat. */
  function resetForm() {
    setEditingId(null);
    setCategory("workshop");
    setAppliesTo({ appliesTo: "all", appliesType: null, busIds: [] });
    setAmount("");
    setNote("");
    setSpentOn(todayInIst());
    setPaidVia("bank");
    setSpreadMonths(1);
    setRepeatMonthly(false);
  }

  function startEdit(item: CompanyExpense) {
    setEditingId(item.id);
    setCategory(item.category);
    setAppliesTo({ appliesTo: item.appliesTo, appliesType: item.appliesType, busIds: item.busIds });
    setAmount(String(item.amountInr));
    setNote(item.note);
    setSpentOn(item.spentOn);
    setPaidVia(item.paidVia);
    setSpreadMonths(item.spreadMonths);
    setRepeatMonthly(item.repeatMonthly);
    setFormError("");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function run(action: () => Promise<void>) {
    setSaving(true);
    setFormError("");
    try {
      await action();
      reload();
    } catch (saveError) {
      setFormError(messageFromUnknown(saveError));
    } finally {
      setSaving(false);
    }
  }

  function saveCost() {
    const value = wholeNumber(amount);
    if (!value) return setFormError("Enter the amount in rupees.");
    const input = { ...appliesTo, spentOn, category, amountInr: value, paidVia, note, spreadMonths, repeatMonthly };
    void run(async () => {
      if (editingId) {
        await updateCompanyExpense(supabase, organizationId, editingId, input);
      } else {
        await addCompanyExpense(supabase, organizationId, input, coveredBuses(appliesTo, data.buses).map((bus) => bus.id));
      }
      resetForm();
    });
  }

  /** Adds this month's copy of a repeating cost, dated today. */
  function addRepeat(item: CompanyExpense) {
    const { id: _id, ...rest } = item;
    void _id;
    void run(() =>
      addCompanyExpense(supabase, organizationId, { ...rest, spentOn: todayInIst() }, coveredBuses(item, data.buses).map((bus) => bus.id)),
    );
  }

  function remove(id: string) {
    if (!window.confirm("Delete this cost? This cannot be undone.")) return;
    void run(() => deleteRow(supabase, "company_expenses", organizationId, id));
  }

  const costTotal = data.expenses.reduce((total, item) => total + item.amountInr, 0);
  const due = dueRepeats(data.expenses, todayInIst());
  const value = wholeNumber(amount);
  const spreadLine =
    value && spreadMonths > 1
      ? `${formatInr(Math.round(value / spreadMonths))} a month, ${monthLabel(spentOn, 0)} to ${monthLabel(spentOn, spreadMonths - 1)}, spread day by day in reports.`
      : value
        ? `Counted over ${monthLabel(spentOn, 0)}, day by day, in reports.`
        : "";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Company costs"
        hint="Loan EMIs, auditor, office and workshop bills. Say which buses each cost applies to: all, one bus type, or picked buses."
      />
      <ErrorText message={error} />

      {due.length && !org.viewOnly ? (
        <Card title={`Repeating costs due for ${monthLabel(todayInIst(), 0)}`}>
          {due.map((item, index) => (
            <ListRow
              key={item.id}
              first={index === 0}
              title={companyExpenseLabel(item.category)}
              detail={`Last added ${shortDay(item.spentOn)} · ${appliesLabel(item, data.buses)}`}
              amount={formatInr(item.amountInr)}
              tone="out"
              actions={
                <SmallButton disabled={saving} onClick={() => addRepeat(item)}>
                  Add for this month
                </SmallButton>
              }
            />
          ))}
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[1fr_360px]">
        <Card title="Costs" action={<span className="font-bold text-money-out">{formatInr(costTotal)}</span>}>
          {loading ? (
            <p className="text-muted">Loading…</p>
          ) : data.expenses.length === 0 ? (
            <p className="text-muted">
              No costs yet. Add workshop bills, loan EMIs, auditor fees and other bank payments here.
            </p>
          ) : (
            data.expenses.map((item, index) => (
              <ListRow
                key={item.id}
                first={index === 0}
                title={companyExpenseLabel(item.category)}
                detail={
                  <>
                    {[shortDay(item.spentOn), item.paidVia.toUpperCase(), item.note].filter(Boolean).join(" · ")}
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      <span
                        className={`block w-fit max-w-full truncate rounded-full px-2.5 py-0.5 text-xs font-bold ${CHIP[item.appliesTo]}`}
                      >
                        {appliesLabel(item, data.buses)}
                      </span>
                      {item.spreadMonths > 1 ? (
                        <span className="rounded-full bg-canvas px-2.5 py-0.5 text-xs font-bold text-muted">
                          Spread over {item.spreadMonths} months
                        </span>
                      ) : null}
                      {item.repeatMonthly ? (
                        <span className="rounded-full bg-canvas px-2.5 py-0.5 text-xs font-bold text-muted">Repeats monthly</span>
                      ) : null}
                    </span>
                  </>
                }
                amount={formatInr(item.amountInr)}
                tone="out"
                actions={
                  !org.viewOnly ? (
                    <>
                      <SmallButton disabled={saving} onClick={() => startEdit(item)}>
                        Edit
                      </SmallButton>
                      <SmallButton disabled={saving} onClick={() => remove(item.id)}>
                        Delete
                      </SmallButton>
                    </>
                  ) : null
                }
              />
            ))
          )}
        </Card>
        {!org.viewOnly ? (
          <Card title={editingId ? "Change this cost" : "Add a cost"}>
            <label className={LABEL}>
              What for
              <select
                className={FIELD}
                value={category}
                onChange={(event) => setCategory(event.target.value as CompanyExpenseCategory)}
              >
                {/* Tyre bills are entered on the Tyres screen, so they are charged to the right bus. */}
                {COMPANY_EXPENSE_CATEGORIES.filter((item) => item.id !== "tyre_retread").map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal text-muted">Tyre and retread bills go on the Tyres screen of each module.</span>
            </label>
            <AppliesToPicker value={appliesTo} onChange={setAppliesTo} buses={sortedBuses} types={types} />
            <div className="grid grid-cols-2 gap-3">
              <label className={LABEL}>
                Date
                <input type="date" className={FIELD} value={spentOn} onChange={(event) => setSpentOn(event.target.value)} />
              </label>
              <label className={LABEL}>
                Amount ₹
                <input inputMode="numeric" className={FIELD} value={amount} onChange={(event) => setAmount(event.target.value)} />
              </label>
            </div>
            <label className={LABEL}>
              Spread over
              <select
                className={FIELD}
                value={spreadMonths}
                onChange={(event) => setSpreadMonths(Number(event.target.value) as SpreadMonths)}
              >
                <option value={1}>1 month</option>
                <option value={3}>3 months</option>
                <option value={6}>6 months</option>
                <option value={12}>12 months (yearly insurance, permit, FC)</option>
              </select>
              {spreadLine ? <span className="text-xs font-normal text-muted">{spreadLine}</span> : null}
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
              <input
                type="checkbox"
                className="size-5 accent-brand"
                checked={repeatMonthly}
                onChange={(event) => setRepeatMonthly(event.target.checked)}
              />
              Repeat every month (shows as due at the top each month)
            </label>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Paid by">
              {PAID_VIA.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={paidVia === item.id}
                  onClick={() => setPaidVia(item.id)}
                  className={`h-11 rounded-full text-sm font-bold ${
                    paidVia === item.id ? "bg-brand text-white" : "bg-canvas text-muted"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label className={LABEL}>
              Note (optional)
              <input className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <ErrorText message={formError} />
            <button type="button" className={PRIMARY} disabled={saving} onClick={saveCost}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Save cost"}
            </button>
            {editingId ? (
              <button type="button" className="text-sm font-bold text-brand" onClick={resetForm}>
                Cancel
              </button>
            ) : null}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
