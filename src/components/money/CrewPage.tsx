"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  addCrewPerson,
  addSalaryPayment,
  deleteRow,
  listCrewPeople,
  listSalaryPayments,
  markTripSettled,
  updateCrewPerson,
} from "@data/money/repository";
import { listTripsWithLines } from "@data/trips/repository";
import type { CrewJob, CrewPerson } from "@domain/money/types";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { hasScreen, MODULE_LABELS, moduleHref, type ModuleId } from "@domain/modules/modules";
import { formatInr, todayInIst } from "@domain/operations/totals";
import { settlementText, tripTotals } from "@domain/trips/checks";
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
  SECONDARY,
  SmallButton,
  Tabs,
  messageFromUnknown,
  shortDay,
  useLoaded,
  wholeNumber,
} from "@/components/ui/kit";

type Section = "salaries" | "advances" | "people";

const EMPTY_PERSON: Omit<CrewPerson, "id"> = {
  module: "town",
  name: "",
  job: "driver",
  phone: "",
  monthlySalaryInr: 0,
  licenceNo: "",
  active: true,
};

function monthLabel(month: string) {
  const [year, value] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(
    new Date(year, value - 1, 1),
  );
}

export function CrewPage({
  organizationId,
  module,
  modules,
}: {
  organizationId: string;
  module: ModuleId;
  /** Modules a person can be moved to. */
  modules: ModuleId[];
}) {
  const hasTrips = hasScreen(module, "trips");
  const org = useOrg();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const { data, loading, error, reload } = useLoaded(
    async () => {
      const [allPeople, allSalaries, allTrips, buses] = await Promise.all([
        listCrewPeople(supabase, organizationId),
        listSalaryPayments(supabase, organizationId),
        listTripsWithLines(supabase, organizationId, { approvedOnly: true }),
        createSupabaseOperationsRepository(supabase).listBuses(organizationId),
      ]);
      // This module's people and their salaries, and trips of this module's buses.
      const people = allPeople.filter((item) => item.module === module);
      const ids = new Set(people.map((item) => item.id));
      const busIds = new Set(buses.filter((bus) => bus.busType === module).map((bus) => bus.id));
      return {
        people,
        salaries: allSalaries.filter((item) => ids.has(item.personId)),
        trips: allTrips.filter((trip) => busIds.has(trip.busId)),
      };
    },
    { people: [], salaries: [], trips: [] },
  );

  const [section, setSection] = useState<Section>("salaries");
  const [month, setMonth] = useState(todayInIst().slice(0, 7));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [person, setPerson] = useState(EMPTY_PERSON);
  const [salaryText, setSalaryText] = useState("");
  const [payAmounts, setPayAmounts] = useState<Record<string, string>>({});

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

  const forMonth = `${month}-01`;
  const active = data.people.filter((item) => item.active);
  const paidThisMonth = data.salaries.filter((item) => item.forMonth === forMonth);
  const monthPaid = paidThisMonth.reduce((total, item) => total + item.amountInr, 0);
  // A salary can be paid in parts; what is left is the salary less every part paid.
  const paymentsOf = (personId: string) =>
    paidThisMonth
      .filter((payment) => payment.personId === personId)
      .sort((left, right) => right.paidOn.localeCompare(left.paidOn));
  const paidTo = (personId: string) =>
    paymentsOf(personId).reduce((total, payment) => total + payment.amountInr, 0);
  const leftFor = (item: CrewPerson) => Math.max(item.monthlySalaryInr - paidTo(item.id), 0);
  const monthDue = active.reduce((total, item) => total + leftFor(item), 0);

  const openAdvances = data.trips
    .filter((trip) => !trip.settledOn)
    .map((trip) => ({ trip, balance: tripTotals(trip).balanceInr }))
    .filter((item) => item.balance !== 0);
  const toPay = openAdvances.filter((item) => item.balance > 0).reduce((t, i) => t + i.balance, 0);
  const toCollect = openAdvances.filter((item) => item.balance < 0).reduce((t, i) => t - i.balance, 0);

  function startEdit(item: CrewPerson | null) {
    setFormError("");
    setEditing(item ? item.id : "new");
    setPerson(
      item
        ? {
            module: item.module,
            name: item.name,
            job: item.job,
            phone: item.phone,
            monthlySalaryInr: item.monthlySalaryInr,
            licenceNo: item.licenceNo,
            active: item.active,
          }
        : { ...EMPTY_PERSON, module },
    );
    setSalaryText(item?.monthlySalaryInr ? String(item.monthlySalaryInr) : "");
  }

  function savePerson() {
    if (!person.name.trim()) return setFormError("Enter the name.");
    const salary = salaryText.trim() ? wholeNumber(salaryText) : 0;
    if (salary == null) return setFormError("Enter the monthly salary in rupees.");
    const input = { ...person, name: person.name.trim(), monthlySalaryInr: salary };
    void run(async () => {
      if (editing && editing !== "new") {
        await updateCrewPerson(supabase, organizationId, editing, input);
      } else {
        await addCrewPerson(supabase, organizationId, input);
      }
      setEditing(null);
    });
  }

  function paySalary(item: CrewPerson) {
    const typed = payAmounts[item.id];
    const amount = typed == null || typed === "" ? leftFor(item) : wholeNumber(typed);
    if (!amount) return setFormError(`Enter the amount paid to ${item.name}.`);
    void run(async () => {
      await addSalaryPayment(supabase, organizationId, {
        personId: item.id,
        forMonth,
        paidOn: todayInIst(),
        amountInr: amount,
        note: "",
      });
      setPayAmounts((all) => ({ ...all, [item.id]: "" }));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Crew"
        hint={hasTrips ? "Salaries, trip advances and your drivers and cleaners." : "Salaries and your drivers and conductors."}
      />
      <Tabs<Section>
        value={section}
        onChange={(next) => {
          setSection(next);
          setFormError("");
        }}
        options={[
          { id: "salaries", label: "Salaries" },
          ...(hasTrips
            ? [{ id: "advances" as const, label: `Open advances${openAdvances.length ? ` (${openAdvances.length})` : ""}` }]
            : []),
          { id: "people", label: "People" },
        ]}
      />
      <ErrorText message={error} />
      <ErrorText message={formError} />

      {section === "salaries" ? (
        <Card
          title={`Salaries for ${monthLabel(month)}`}
          action={
            <input
              type="month"
              aria-label="Month"
              className="h-11 rounded-2xl bg-canvas px-3 text-sm font-semibold"
              value={month}
              onChange={(event) => event.target.value && setMonth(event.target.value)}
            />
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-canvas p-3">
              <p className="text-xs text-muted">Paid</p>
              <p className="text-lg font-extrabold text-money-in">{formatInr(monthPaid)}</p>
            </div>
            <div className="rounded-2xl bg-canvas p-3">
              <p className="text-xs text-muted">Still to pay</p>
              <p className="text-lg font-extrabold text-money-out">{formatInr(monthDue)}</p>
            </div>
          </div>
          {loading ? (
            <p className="text-muted">Loading…</p>
          ) : active.length === 0 ? (
            <p className="text-muted">Add your drivers and cleaners under People first.</p>
          ) : (
            active.map((item, index) => {
              const payments = paymentsOf(item.id);
              const paidInr = paidTo(item.id);
              const leftInr = leftFor(item);
              const fullyPaid = payments.length > 0 && leftInr === 0;
              const latest = payments[0];
              return (
                <ListRow
                  key={item.id}
                  first={index === 0}
                  title={item.name}
                  detail={
                    fullyPaid
                      ? payments.length === 1
                        ? `Paid ${formatInr(paidInr)} on ${shortDay(latest.paidOn)}`
                        : `Paid ${formatInr(paidInr)} in ${payments.length} parts, last on ${shortDay(latest.paidOn)}`
                      : payments.length
                        ? `Paid ${formatInr(paidInr)} of ${formatInr(item.monthlySalaryInr)} · ${formatInr(leftInr)} still to pay`
                        : `${item.job === "driver" ? "Driver" : "Cleaner"} · ${formatInr(item.monthlySalaryInr)} a month`
                  }
                  tone={fullyPaid ? "in" : "ink"}
                  amount={fullyPaid ? "Paid" : undefined}
                  actions={
                    org.viewOnly ? null : (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {latest ? (
                          <SmallButton disabled={saving} onClick={() => run(() => deleteRow(supabase, "salary_payments", organizationId, latest.id))}>
                            Undo
                          </SmallButton>
                        ) : null}
                        {fullyPaid ? null : (
                          <>
                            <input
                              inputMode="numeric"
                              aria-label={`Amount for ${item.name}`}
                              className="h-11 w-24 rounded-2xl bg-canvas px-3 text-right"
                              placeholder={String(leftInr || "")}
                              value={payAmounts[item.id] ?? ""}
                              onChange={(event) => setPayAmounts((all) => ({ ...all, [item.id]: event.target.value }))}
                            />
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => paySalary(item)}
                              className="h-11 rounded-2xl bg-brand px-4 text-sm font-bold text-white disabled:opacity-50"
                            >
                              {payments.length ? "Pay the rest" : "Mark paid"}
                            </button>
                          </>
                        )}
                      </div>
                    )
                  }
                />
              );
            })
          )}
        </Card>
      ) : null}

      {section === "advances" ? (
        <Card title="Trip advances not settled">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-canvas p-3">
              <p className="text-xs text-muted">To pay drivers</p>
              <p className="text-lg font-extrabold text-money-out">{formatInr(toPay)}</p>
            </div>
            <div className="rounded-2xl bg-canvas p-3">
              <p className="text-xs text-muted">Drivers to return</p>
              <p className="text-lg font-extrabold text-money-in">{formatInr(toCollect)}</p>
            </div>
          </div>
          {openAdvances.length === 0 ? (
            <p className="text-muted">Every approved trip sheet is settled.</p>
          ) : (
            openAdvances.map(({ trip, balance }, index) => (
              <ListRow
                key={trip.id}
                first={index === 0}
                title={
                  <Link href={`${moduleHref(module, "trips")}/${trip.id}`} className="underline-offset-2 hover:underline">
                    {trip.driver1 || "Driver not named"} · sheet {trip.sheetNo || "–"}
                  </Link>
                }
                detail={`${trip.route || "Trip"}${trip.startedAt ? ` · ${shortDay(trip.startedAt)}` : ""} · ${settlementText(balance)}`}
                amount={formatInr(Math.abs(balance))}
                tone={balance > 0 ? "out" : "in"}
                actions={
                  !org.viewOnly ? (
                    <SmallButton
                      tone="brand"
                      disabled={saving}
                      onClick={() => run(() => markTripSettled(supabase, organizationId, trip.id, todayInIst()))}
                    >
                      Settled
                    </SmallButton>
                  ) : null
                }
              />
            ))
          )}
        </Card>
      ) : null}

      {section === "people" ? (
        <div className="grid gap-4 md:grid-cols-[1fr_360px]">
          <Card
            title="Drivers and cleaners"
            action={
              !org.viewOnly ? (
                <SmallButton tone="brand" onClick={() => startEdit(null)}>
                  + Add person
                </SmallButton>
              ) : null
            }
          >
            {data.people.length === 0 ? (
              <p className="text-muted">No one added yet.</p>
            ) : (
              data.people.map((item, index) => (
                <ListRow
                  key={item.id}
                  first={index === 0}
                  title={`${item.name}${item.active ? "" : " (left)"}`}
                  detail={[item.job === "driver" ? "Driver" : "Cleaner", item.phone, item.licenceNo && `Licence ${item.licenceNo}`]
                    .filter(Boolean)
                    .join(" · ")}
                  amount={item.monthlySalaryInr ? formatInr(item.monthlySalaryInr) : undefined}
                  actions={
                    !org.viewOnly ? (
                      <SmallButton onClick={() => startEdit(item)}>Edit</SmallButton>
                    ) : null
                  }
                />
              ))
            )}
          </Card>
          {editing && !org.viewOnly ? (
            <Card title={editing === "new" ? "Add person" : "Edit person"}>
              <label className={LABEL}>
                Name
                <input className={FIELD} value={person.name} onChange={(event) => setPerson({ ...person, name: event.target.value })} />
              </label>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Job">
                {(["driver", "cleaner"] as CrewJob[]).map((job) => (
                  <button
                    key={job}
                    type="button"
                    aria-pressed={person.job === job}
                    onClick={() => setPerson({ ...person, job })}
                    className={`h-11 rounded-full text-sm font-bold ${
                      person.job === job ? "bg-brand text-white" : "bg-canvas text-muted"
                    }`}
                  >
                    {job === "driver" ? "Driver" : "Cleaner"}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className={LABEL}>
                  Phone
                  <input inputMode="tel" className={FIELD} value={person.phone} onChange={(event) => setPerson({ ...person, phone: event.target.value })} />
                </label>
                <label className={LABEL}>
                  Salary a month ₹
                  <input inputMode="numeric" className={FIELD} value={salaryText} onChange={(event) => setSalaryText(event.target.value)} />
                </label>
              </div>
              {modules.length > 1 ? (
                <label className={LABEL}>
                  Module
                  <select
                    className={FIELD}
                    value={person.module}
                    onChange={(event) => setPerson({ ...person, module: event.target.value as ModuleId })}
                  >
                    {modules.map((item) => (
                      <option key={item} value={item}>
                        {MODULE_LABELS[item]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {person.job === "driver" ? (
                <label className={LABEL}>
                  Licence number
                  <input className={FIELD} value={person.licenceNo} onChange={(event) => setPerson({ ...person, licenceNo: event.target.value })} />
                </label>
              ) : null}
              <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
                <input
                  type="checkbox"
                  className="size-5 accent-brand"
                  checked={person.active}
                  onChange={(event) => setPerson({ ...person, active: event.target.checked })}
                />
                Still working here
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" className={SECONDARY} onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button type="button" className={PRIMARY} disabled={saving} onClick={savePerson}>
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
