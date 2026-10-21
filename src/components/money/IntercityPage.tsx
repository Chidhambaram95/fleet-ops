"use client";

import { useMemo, useState } from "react";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import {
  addIntercityIncome,
  deleteRow,
  listIntercityIncome,
} from "@data/money/repository";
import type { ModuleId } from "@domain/modules/modules";
import { formatInr, shiftDate, todayInIst } from "@domain/operations/totals";
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

/** Omni module: fortnightly Intercity payments, shared equally by the buses they cover. */
export function IntercityPage({ organizationId, module }: { organizationId: string; module: ModuleId }) {
  const org = useOrg();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const { data, loading, error, reload } = useLoaded(
    async () => {
      const [intercity, buses] = await Promise.all([
        listIntercityIncome(supabase, organizationId),
        createSupabaseOperationsRepository(supabase).listBuses(organizationId),
      ]);
      return { intercity, buses };
    },
    { intercity: [], buses: [] },
  );
  const busName = (id: string) => data.buses.find((bus) => bus.id === id)?.registrationNumber ?? "Bus";
  const intercityBuses = data.buses.filter((bus) => bus.busType === module);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

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

  function remove(id: string) {
    if (!window.confirm("Delete this Intercity payment? This cannot be undone.")) return;
    void run(() => deleteRow(supabase, "intercity_income", organizationId, id));
  }

  const incomeTotal = data.intercity.reduce((total, item) => total + item.amountInr, 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Intercity" hint="Fortnightly payments from Intercity for your omni buses." />
      <ErrorText message={error} />
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
                {intercityBuses.map((bus) => {
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
    </div>
  );
}
