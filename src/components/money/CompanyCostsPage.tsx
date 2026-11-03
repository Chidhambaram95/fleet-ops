"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import {
  addCompanyExpense,
  deleteRow,
  listCompanyExpenses,
} from "@data/money/repository";
import { COMPANY_EXPENSE_CATEGORIES, PAID_VIA, companyExpenseLabel } from "@domain/money/catalog";
import type { CompanyExpense, CompanyExpenseCategory, CostAppliesTo, PaidVia } from "@domain/money/types";
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
        <div className="absolute inset-x-0 top-full z-20 mt-1 flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto rounded-2xl bg-white p-2 shadow-xl ring-1 ring-line">
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
          <button
            type="button"
            className="mt-1 h-10 rounded-full bg-canvas text-sm font-bold text-brand"
            onClick={() => setOpen(false)}
          >
            Done
          </button>
        </div>
      ) : null}
      <p className="text-xs text-muted">
        {value.appliesTo === "all"
          ? `Split among all ${plural(buses.length)} in reports, by the days each bus ran.`
          : value.appliesTo === "type"
            ? `Split among the ${plural(covered.length)} ${typeName} buses (and any added later), by the days each ran.`
            : covered.length === 1
              ? `Counted against ${covered[0].registrationNumber} only.`
              : `Split among these ${plural(covered.length)} by the days each ran.`}
      </p>
    </div>
  );
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
    void run(async () => {
      await addCompanyExpense(
        supabase,
        organizationId,
        {
          ...appliesTo,
          spentOn,
        category,
        amountInr: value,
          paidVia,
          note,
        },
        coveredBuses(appliesTo, data.buses).map((bus) => bus.id),
      );
      setAmount("");
      setNote("");
    });
  }

  function remove(id: string) {
    if (!window.confirm("Delete this cost? This cannot be undone.")) return;
    void run(() => deleteRow(supabase, "company_expenses", organizationId, id));
  }

  const costTotal = data.expenses.reduce((total, item) => total + item.amountInr, 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Company costs"
        hint="Loan EMIs, auditor, office and workshop bills. Say which buses each cost applies to: all, one bus type, or picked buses."
      />
      <ErrorText message={error} />

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
                    <span
                      className={`mt-1.5 block w-fit max-w-full truncate rounded-full px-2.5 py-0.5 text-xs font-bold ${CHIP[item.appliesTo]}`}
                    >
                      {appliesLabel(item, data.buses)}
                    </span>
                  </>
                }
                amount={formatInr(item.amountInr)}
                tone="out"
                actions={
                  !org.viewOnly ? (
                    <SmallButton disabled={saving} onClick={() => remove(item.id)}>
                      Delete
                    </SmallButton>
                  ) : null
                }
              />
            ))
          )}
        </Card>
        {!org.viewOnly ? (
          <Card title="Add a cost">
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
              {saving ? "Saving…" : "Save cost"}
            </button>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
