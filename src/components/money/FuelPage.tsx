"use client";

import { useMemo, useState } from "react";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import {
  addPumpPayment,
  addPumpStatement,
  deleteRow,
  listPumpPayments,
  listPumpStatements,
} from "@data/money/repository";
import { listTripsWithLines } from "@data/trips/repository";
import { busMileage, pumpBalances } from "@domain/money/fuel";
import { formatInr, todayInIst } from "@domain/operations/totals";
import { useOrg } from "@/components/billing/OrgContext";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import {
  Card,
  Empty,
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

type Mode = "statement" | "payment";

export function FuelPage({ organizationId }: { organizationId: string }) {
  const org = useOrg();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const { data, loading, error, reload } = useLoaded(
    async () => {
      const [trips, payments, statements, buses] = await Promise.all([
        listTripsWithLines(supabase, organizationId, { approvedOnly: true }),
        listPumpPayments(supabase, organizationId),
        listPumpStatements(supabase, organizationId),
        createSupabaseOperationsRepository(supabase).listBuses(organizationId),
      ]);
      return { trips, payments, statements, buses };
    },
    { trips: [], payments: [], statements: [], buses: [] },
  );

  const pumps = useMemo(
    () => pumpBalances(data.trips, data.payments, data.statements),
    [data],
  );
  const mileage = useMemo(() => busMileage(data.trips), [data.trips]);
  const busName = (id: string) =>
    data.buses.find((bus) => bus.id === id)?.registrationNumber ?? "Bus";

  const [mode, setMode] = useState<Mode>("statement");
  const [pump, setPump] = useState("");
  const [day, setDay] = useState(todayInIst());
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function save() {
    const value = wholeNumber(amount);
    if (!pump.trim()) return setFormError("Enter the pump name.");
    if (value == null) return setFormError("Enter the amount in rupees.");
    setSaving(true);
    setFormError("");
    try {
      if (mode === "statement") {
        await addPumpStatement(supabase, organizationId, {
          pump: pump.trim(),
          statementOn: day,
          outstandingInr: value,
          note,
        });
      } else {
        await addPumpPayment(supabase, organizationId, {
          pump: pump.trim(),
          paidOn: day,
          amountInr: value,
          reference: note,
        });
      }
      setAmount("");
      setNote("");
      reload();
    } catch (saveError) {
      setFormError(messageFromUnknown(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function remove(table: "pump_payments" | "pump_statements", id: string) {
    try {
      await deleteRow(supabase, table, organizationId, id);
      reload();
    } catch (removeError) {
      setFormError(messageFromUnknown(removeError));
    }
  }

  const history = [
    ...data.payments.map((item) => ({
      id: item.id,
      table: "pump_payments" as const,
      day: item.paidOn,
      title: `Paid ${item.pump}`,
      detail: item.reference,
      amount: item.amountInr,
    })),
    ...data.statements.map((item) => ({
      id: item.id,
      table: "pump_statements" as const,
      day: item.statementOn,
      title: `${item.pump} says outstanding`,
      detail: item.note,
      amount: item.outstandingInr,
    })),
  ]
    .sort((left, right) => right.day.localeCompare(left.day))
    .slice(0, 30);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Fuel"
        hint="Credit diesel from approved trip sheets, checked against each pump."
      />
      <ErrorText message={error} />

      <div className="grid gap-4 md:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Pump outstanding">
            {loading ? (
              <p className="text-muted">Loading…</p>
            ) : pumps.length === 0 ? (
              <p className="text-muted">
                No credit diesel yet. Credit fills on approved trip sheets show up here.
              </p>
            ) : (
              pumps.map((item, index) => (
                <div
                  key={item.pump}
                  className={`flex flex-col gap-1 py-3 ${index ? "border-t border-line" : ""}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate font-bold">{item.pump}</p>
                    <p className="shrink-0 text-lg font-extrabold text-money-out">
                      {formatInr(item.expectedInr)}
                    </p>
                  </div>
                  <p className="text-xs text-muted">
                    Credit {formatInr(item.creditInr)}
                    {item.creditLitres ? ` · ${Math.round(item.creditLitres)} L` : ""} · Paid{" "}
                    {formatInr(item.paidInr)}
                  </p>
                  {item.latest && item.differenceInr != null ? (
                    item.differenceInr === 0 ? (
                      <p className="text-xs font-semibold text-money-in">
                        Matches the pump&apos;s figure of {shortDay(item.latest.statementOn)}.
                      </p>
                    ) : (
                      <p className="rounded-xl bg-warn-bg px-3 py-2 text-xs font-semibold text-warn-ink">
                        Pump says {formatInr(item.latest.outstandingInr)} on{" "}
                        {shortDay(item.latest.statementOn)}.{" "}
                        {item.differenceInr > 0
                          ? `That is ${formatInr(item.differenceInr)} more than the trip sheets show. Check for a missing trip sheet.`
                          : `That is ${formatInr(-item.differenceInr)} less than the trip sheets show. Check for a payment not entered here.`}
                      </p>
                    )
                  ) : null}
                </div>
              ))
            )}
          </Card>

          <Card title="Mileage by bus">
            {mileage.length === 0 ? (
              <p className="text-muted">
                Mileage shows once approved trips have km and diesel litres.
              </p>
            ) : (
              mileage.map((item, index) => (
                <ListRow
                  key={item.busId}
                  first={index === 0}
                  title={busName(item.busId)}
                  detail={
                    item.low
                      ? `Last trip ${item.last?.toFixed(1)} km/L, well below usual. Check sheet ${item.lastSheetNo || "last trip"}.`
                      : `${item.trips} trips · ${Math.round(item.km).toLocaleString("en-IN")} km · last ${item.last?.toFixed(1)} km/L`
                  }
                  amount={`${item.usual?.toFixed(1) ?? "–"} km/L`}
                  tone={item.low ? "out" : "ink"}
                />
              ))
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {!org.viewOnly ? (
            <Card title="Add for a pump">
              <Tabs<Mode>
                value={mode}
                onChange={setMode}
                options={[
                  { id: "statement", label: "Pump's figure" },
                  { id: "payment", label: "Payment" },
                ]}
              />
              <label className={LABEL}>
                Pump name
                <input
                  className={FIELD}
                  list="pump-names"
                  value={pump}
                  onChange={(event) => setPump(event.target.value)}
                  placeholder="e.g. Sri Murugan Fuels"
                />
                <datalist id="pump-names">
                  {pumps.map((item) => (
                    <option key={item.pump} value={item.pump} />
                  ))}
                </datalist>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={LABEL}>
                  {mode === "statement" ? "Statement date" : "Paid on"}
                  <input
                    type="date"
                    className={FIELD}
                    value={day}
                    onChange={(event) => setDay(event.target.value)}
                  />
                </label>
                <label className={LABEL}>
                  {mode === "statement" ? "Outstanding ₹" : "Amount ₹"}
                  <input
                    inputMode="numeric"
                    className={FIELD}
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </label>
              </div>
              <label className={LABEL}>
                {mode === "statement" ? "Note (optional)" : "Cheque / UPI ref (optional)"}
                <input className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
              <ErrorText message={formError} />
              <button type="button" className={PRIMARY} disabled={saving} onClick={save}>
                {saving ? "Saving…" : mode === "statement" ? "Save pump's figure" : "Save payment"}
              </button>
            </Card>
          ) : null}

          <Card title="Recent">
            {history.length === 0 ? (
              <p className="text-muted">Nothing entered yet.</p>
            ) : (
              history.map((item, index) => (
                <ListRow
                  key={item.id}
                  first={index === 0}
                  title={item.title}
                  detail={[shortDay(item.day), item.detail].filter(Boolean).join(" · ")}
                  amount={formatInr(item.amount)}
                  actions={
                    !org.viewOnly ? (
                      <SmallButton onClick={() => remove(item.table, item.id)}>Delete</SmallButton>
                    ) : null
                  }
                />
              ))
            )}
          </Card>
        </div>
      </div>
      {!loading && data.trips.length === 0 ? (
        <Empty>Approve trip sheets on the Trips page to see fuel figures here.</Empty>
      ) : null}
    </div>
  );
}
