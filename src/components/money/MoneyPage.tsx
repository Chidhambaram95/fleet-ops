"use client";

import { useMemo, useState } from "react";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import {
  addCompanyExpense,
  addIntercityIncome,
  deleteRow,
  listCompanyExpenses,
  listIntercityIncome,
} from "@data/money/repository";
import { COMPANY_EXPENSE_CATEGORIES, PAID_VIA, companyExpenseLabel } from "@domain/money/catalog";
import type { CompanyExpenseCategory, PaidVia } from "@domain/money/types";
import { formatInr, shiftDate, todayInIst } from "@domain/operations/totals";
import { useOrg } from "@/components/billing/OrgContext";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import {
  BusSelect,
  Card,
  ErrorText,
  FIELD,
  LABEL,
  ListRow,
  PageHeader,
  PRIMARY,
  SmallButton,
  Tabs,
  messageFromUnknown,
  shortDay,
  useLoaded,
  wholeNumber,
} from "@/components/ui/kit";

type Section = "costs" | "intercity";

export function MoneyPage({ organizationId }: { organizationId: string }) {
  const org = useOrg();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const { data, loading, error, reload } = useLoaded(
    async () => {
      const [expenses, intercity, buses] = await Promise.all([
        listCompanyExpenses(supabase, organizationId),
        listIntercityIncome(supabase, organizationId),
        createSupabaseOperationsRepository(supabase).listBuses(organizationId),
      ]);
      return { expenses, intercity, buses };
    },
    { expenses: [], intercity: [], buses: [] },
  );
  const busName = (id: string | null) =>
    id ? (data.buses.find((bus) => bus.id === id)?.registrationNumber ?? "Bus") : "Company";
  const intercityBuses = data.buses.filter((bus) => bus.busType === "omni");

  const [section, setSection] = useState<Section>("costs");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Company cost form
  const [spentOn, setSpentOn] = useState(todayInIst());
  const [category, setCategory] = useState<CompanyExpenseCategory>("workshop");
  const [busId, setBusId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidVia, setPaidVia] = useState<PaidVia>("bank");
  const [note, setNote] = useState("");

  // Intercity form
  const [periodStart, setPeriodStart] = useState(shiftDate(todayInIst(), -14));
  const [periodEnd, setPeriodEnd] = useState(shiftDate(todayInIst(), -1));
  const [receivedOn, setReceivedOn] = useState(todayInIst());
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeBuses, setIncomeBuses] = useState<string[]>([]);
  const [incomeNote, setIncomeNote] = useState("");

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
      await addCompanyExpense(supabase, organizationId, {
        busId: busId || null,
        spentOn,
        category,
        amountInr: value,
        paidVia,
        note,
      });
      setAmount("");
      setNote("");
    });
  }

  function saveIncome() {
    const value = wholeNumber(incomeAmount);
    if (!value) return setFormError("Enter the amount received.");
    if (periodEnd < periodStart) return setFormError("The period ends before it starts.");
    if (incomeBuses.length === 0) return setFormError("Pick the buses this payment covers.");
    void run(async () => {
      await addIntercityIncome(supabase, organizationId, {
        periodStart,
        periodEnd,
        receivedOn,
        amountInr: value,
        busIds: incomeBuses,
        note: incomeNote,
      });
      setIncomeAmount("");
      setIncomeNote("");
    });
  }

  function remove(table: "company_expenses" | "intercity_income", id: string) {
    void run(() => deleteRow(supabase, table, organizationId, id));
  }

  const costTotal = data.expenses.reduce((total, item) => total + item.amountInr, 0);
  const incomeTotal = data.intercity.reduce((total, item) => total + item.amountInr, 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Bank & Intercity"
        hint="Costs paid from the bank or for the company, and Intercity payments."
      />
      <Tabs<Section>
        value={section}
        onChange={(next) => {
          setSection(next);
          setFormError("");
        }}
        options={[
          { id: "costs", label: "Bank & company costs" },
          { id: "intercity", label: "Intercity income" },
        ]}
      />
      <ErrorText message={error} />

      {section === "costs" ? (
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
                  title={`${companyExpenseLabel(item.category)} · ${busName(item.busId)}`}
                  detail={[shortDay(item.spentOn), item.paidVia.toUpperCase(), item.note]
                    .filter(Boolean)
                    .join(" · ")}
                  amount={formatInr(item.amountInr)}
                  tone="out"
                  actions={
                    !org.viewOnly ? (
                      <SmallButton disabled={saving} onClick={() => remove("company_expenses", item.id)}>
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
                  {COMPANY_EXPENSE_CATEGORIES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL}>
                Bus
                <BusSelect buses={data.buses} value={busId} onChange={setBusId} allLabel="Company (no bus)" />
              </label>
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
      ) : (
        <div className="grid gap-4 md:grid-cols-[1fr_360px]">
          <Card title="Payments received" action={<span className="font-bold text-money-in">{formatInr(incomeTotal)}</span>}>
            {loading ? (
              <p className="text-muted">Loading…</p>
            ) : data.intercity.length === 0 ? (
              <p className="text-muted">No Intercity payments yet.</p>
            ) : (
              data.intercity.map((item, index) => (
                <ListRow
                  key={item.id}
                  first={index === 0}
                  title={`${shortDay(item.periodStart)} to ${shortDay(item.periodEnd)}`}
                  detail={[
                    `Received ${shortDay(item.receivedOn)}`,
                    item.busIds.map((id) => busName(id)).join(", "),
                    item.note,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  amount={formatInr(item.amountInr)}
                  tone="in"
                  actions={
                    !org.viewOnly ? (
                      <SmallButton disabled={saving} onClick={() => remove("intercity_income", item.id)}>
                        Delete
                      </SmallButton>
                    ) : null
                  }
                />
              ))
            )}
          </Card>
          {!org.viewOnly ? (
            <Card title="Add Intercity payment">
              <div className="grid grid-cols-2 gap-3">
                <label className={LABEL}>
                  Period from
                  <input type="date" className={FIELD} value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
                </label>
                <label className={LABEL}>
                  Period to
                  <input type="date" className={FIELD} value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
                </label>
                <label className={LABEL}>
                  Received on
                  <input type="date" className={FIELD} value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} />
                </label>
                <label className={LABEL}>
                  Amount ₹
                  <input
                    inputMode="numeric"
                    className={FIELD}
                    value={incomeAmount}
                    onChange={(event) => setIncomeAmount(event.target.value)}
                  />
                </label>
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-[13px] font-semibold">Buses covered (shared equally in reports)</legend>
                {(intercityBuses.length ? intercityBuses : data.buses).map((bus) => {
                  const checked = incomeBuses.includes(bus.id);
                  return (
                    <label key={bus.id} className="flex min-h-11 items-center gap-3 rounded-2xl bg-canvas px-4">
                      <input
                        type="checkbox"
                        className="size-5 accent-brand"
                        checked={checked}
                        onChange={() =>
                          setIncomeBuses((list) =>
                            checked ? list.filter((id) => id !== bus.id) : [...list, bus.id],
                          )
                        }
                      />
                      <span className="font-semibold">{bus.registrationNumber}</span>
                    </label>
                  );
                })}
              </fieldset>
              <label className={LABEL}>
                Note (optional)
                <input className={FIELD} value={incomeNote} onChange={(event) => setIncomeNote(event.target.value)} />
              </label>
              <ErrorText message={formError} />
              <button type="button" className={PRIMARY} disabled={saving} onClick={saveIncome}>
                {saving ? "Saving…" : "Save payment"}
              </button>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
