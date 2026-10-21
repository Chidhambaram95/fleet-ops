"use client";

import { useMemo, useState } from "react";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import {
  addCompanyExpense,
  deleteRow,
  listCompanyExpenses,
} from "@data/money/repository";
import { COMPANY_EXPENSE_CATEGORIES, PAID_VIA, companyExpenseLabel } from "@domain/money/catalog";
import type { CompanyExpenseCategory, PaidVia } from "@domain/money/types";
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

/**
 * Company area: bank and company costs. A cost can be for one or more buses;
 * with none picked it is shared across every bus of the company in reports.
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
  const busName = (id: string) => data.buses.find((bus) => bus.id === id)?.registrationNumber ?? "Bus";
  const forBuses = (ids: string[]) =>
    ids.length === 0 ? "Shared by all buses" : ids.map((id) => busName(id)).join(", ");
  const groups = modules
    .map((module) => ({ module, buses: data.buses.filter((bus) => bus.busType === module) }))
    .filter((group) => group.buses.length > 0);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [spentOn, setSpentOn] = useState(todayInIst());
  const [category, setCategory] = useState<CompanyExpenseCategory>("workshop");
  const [busIds, setBusIds] = useState<string[]>([]);
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
      await addCompanyExpense(supabase, organizationId, {
        busIds,
        spentOn,
        category,
        amountInr: value,
        paidVia,
        note,
      });
      setAmount("");
      setNote("");
      setBusIds([]);
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
        title="Bank & company costs"
        hint="Loan EMIs, auditor, office and workshop bills. Pick the buses a cost was for, or leave it for all buses."
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
                title={`${companyExpenseLabel(item.category)} · ${forBuses(item.busIds)}`}
                detail={[shortDay(item.spentOn), item.paidVia.toUpperCase(), item.note]
                  .filter(Boolean)
                  .join(" · ")}
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
                {COMPANY_EXPENSE_CATEGORIES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-[13px] font-semibold">
                Buses (leave empty to share across all buses)
              </legend>
              {groups.map((group) => (
                <div key={group.module} className="flex flex-col gap-2">
                  {groups.length > 1 ? (
                    <span className="text-xs font-bold uppercase text-muted">{MODULE_LABELS[group.module]}</span>
                  ) : null}
                  {group.buses.map((bus) => {
                    const checked = busIds.includes(bus.id);
                    return (
                      <label key={bus.id} className="flex min-h-11 items-center gap-3 rounded-2xl bg-canvas px-4">
                        <input
                          type="checkbox"
                          className="size-5 accent-brand"
                          checked={checked}
                          onChange={() =>
                            setBusIds((list) =>
                              checked ? list.filter((id) => id !== bus.id) : [...list, bus.id],
                            )
                          }
                        />
                        <span className="font-semibold">{bus.registrationNumber}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
              <p className="text-xs text-muted">
                {busIds.length === 0
                  ? "Shared equally by all buses in reports."
                  : busIds.length === 1
                    ? "Counted against this bus in reports."
                    : `Shared equally by these ${busIds.length} buses in reports.`}
              </p>
            </fieldset>
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
