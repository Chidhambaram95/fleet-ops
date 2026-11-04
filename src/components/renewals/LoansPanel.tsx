"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteLoan,
  getEmiReminderDays,
  listLoans,
  resetEmi,
  saveEmi,
  saveEmiReminderDays,
  saveLoan,
  type EmiInput,
} from "@data/loans/repository";
import {
  EMI_STATUS_LABELS,
  addMonths,
  dayLabel,
  daysFrom,
  emiAlertText,
  emiAlerts,
  emiReminderText,
  loanMonths,
  loanSummary,
  loansForModule,
  monthLabel,
  nextEmiMonth,
  type EmiAlert,
  type EmiMonth,
  type EmiStatus,
  type Loan,
} from "@domain/loans/emis";
import type { ModuleId } from "@domain/modules/modules";
import type { Bus } from "@domain/operations/types";
import { formatInr, todayInIst } from "@domain/operations/totals";
import { useOrg } from "@/components/billing/OrgContext";
import {
  Card,
  ErrorText,
  FIELD,
  LABEL,
  PRIMARY,
  SECONDARY,
  SmallButton,
  messageFromUnknown,
  useLoaded,
  wholeNumber,
} from "@/components/ui/kit";

type LoanDraft = {
  id?: string;
  busIds: string[];
  lender: string;
  loanRef: string;
  debitAccount: string;
  emi: string;
  sweepDay: string;
  firstMonth: string;
  lastMonth: string;
  note: string;
};

type EmiDraft = {
  item: EmiMonth;
  status: EmiStatus;
  amount: string;
  fundsAddedOn: string;
  retryOn: string;
  clearedOn: string;
  fee: string;
  fine: string;
  note: string;
};

const STATUS_CLASS: Record<EmiStatus | "overdue" | "soon", string> = {
  due: "bg-brand-soft text-brand",
  soon: "bg-warn-bg text-warn-ink",
  overdue: "bg-money-out text-white",
  missed: "bg-money-out text-white",
  funds_added: "bg-warn-bg text-money-out",
  cleared: "bg-[#e3f4ea] text-money-in",
};

export const ALERT_CLASS: Record<EmiAlert["kind"], string> = {
  overdue: "text-money-out",
  confirm: "text-warn-ink",
  keep_funds: "",
};

const toMonth = (value: string) => (/^\d{4}-\d{2}$/.test(value) ? `${value}-01` : "");

function emptyLoan(busId: string, today: string): LoanDraft {
  const first = nextEmiMonth(5, today);
  return {
    busIds: busId ? [busId] : [],
    lender: "",
    loanRef: "",
    debitAccount: "",
    emi: "",
    sweepDay: "5",
    firstMonth: first.slice(0, 7),
    lastMonth: addMonths(first, 59).slice(0, 7),
    note: "",
  };
}

function loanDraft(loan: Loan): LoanDraft {
  return {
    id: loan.id,
    busIds: loan.busIds,
    lender: loan.lender,
    loanRef: loan.loanRef,
    debitAccount: loan.debitAccount,
    emi: String(loan.emiInr),
    sweepDay: String(loan.sweepDay),
    firstMonth: loan.firstMonth.slice(0, 7),
    lastMonth: loan.lastMonth.slice(0, 7),
    note: loan.note,
  };
}

function emiDraft(item: EmiMonth, status: EmiStatus, today: string): EmiDraft {
  const record = item.record;
  return {
    item,
    status,
    amount: String(item.amountInr),
    fundsAddedOn: record?.fundsAddedOn ?? (status === "funds_added" ? today : ""),
    retryOn: record?.retryOn ?? "",
    clearedOn: record?.clearedOn ?? (status === "cleared" ? today : ""),
    fee: record?.feeInr ? String(record.feeInr) : "",
    fine: record?.fineInr ? String(record.fineInr) : "",
    note: record?.note ?? "",
  };
}

/** The Loans & EMIs tab of Renewals: loans of this module's buses and every month's EMI. */
export function LoansPanel({
  supabase,
  organizationId,
  module,
  buses,
  isAdmin,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  module: ModuleId;
  /** Every bus of the company, to name buses on shared loans. */
  buses: Bus[];
  isAdmin: boolean;
}) {
  const org = useOrg();
  const canEdit = !org.viewOnly;
  const today = todayInIst();
  const { data, loading, error, reload } = useLoaded(
    async () => {
      const [{ loans, emis }, reminderDays] = await Promise.all([
        listLoans(supabase, organizationId),
        getEmiReminderDays(supabase, organizationId),
      ]);
      return { loans, emis, reminderDays };
    },
    { loans: [], emis: [], reminderDays: 3 },
  );
  const busById = useMemo(() => new Map(buses.map((bus) => [bus.id, bus])), [buses]);
  const busName = (id: string) => busById.get(id)?.registrationNumber ?? "Removed bus";
  const myBuses = buses.filter((bus) => bus.busType === module);
  const loans = loansForModule(data.loans, (id) => busById.get(id)?.busType, module);
  const alerts = emiAlerts(loans, data.emis, today, data.reminderDays);

  const [loanForm, setLoanForm] = useState<LoanDraft | null>(null);
  const [emiForm, setEmiForm] = useState<EmiDraft | null>(null);
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function run(action: () => Promise<void>) {
    setSaving(true);
    setFormError("");
    try {
      await action();
      reload();
      return true;
    } catch (runError) {
      setFormError(messageFromUnknown(runError));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submitLoan() {
    if (!loanForm) return;
    const emi = wholeNumber(loanForm.emi);
    const sweepDay = Number(loanForm.sweepDay);
    const firstMonth = toMonth(loanForm.firstMonth);
    const lastMonth = toMonth(loanForm.lastMonth);
    if (!loanForm.busIds.length) return setFormError("Pick the bus or buses on this loan.");
    if (!loanForm.lender.trim()) return setFormError("Enter the bank or lender.");
    if (!emi) return setFormError("Enter the monthly EMI in rupees.");
    if (!firstMonth || !lastMonth) return setFormError("Enter the first and last EMI months.");
    if (lastMonth < firstMonth) return setFormError("The last EMI can't be before the first.");
    const ok = await run(() =>
      saveLoan(
        supabase,
        organizationId,
        {
          busIds: loanForm.busIds,
          lender: loanForm.lender,
          loanRef: loanForm.loanRef,
          debitAccount: loanForm.debitAccount,
          emiInr: emi,
          sweepDay,
          firstMonth,
          lastMonth,
          note: loanForm.note,
        },
        loanForm.id,
      ),
    );
    if (ok) setLoanForm(null);
  }

  async function submitEmi(draft: EmiDraft) {
    const amount = wholeNumber(draft.amount);
    const fee = draft.fee.trim() ? wholeNumber(draft.fee) : 0;
    const fine = draft.fine.trim() ? wholeNumber(draft.fine) : 0;
    if (!amount) return setFormError("Enter the EMI amount.");
    if (fee == null || fine == null) return setFormError("Enter fees and fines in rupees.");
    if (draft.status === "missed" && !draft.note.trim()) return setFormError("Say why it was missed, e.g. low balance.");
    if (draft.status === "funds_added" && !draft.fundsAddedOn) return setFormError("Enter the date the money was added.");
    if (draft.status === "cleared" && !draft.clearedOn) return setFormError("Enter the date it cleared.");
    const input: EmiInput = {
      loanId: draft.item.loan.id,
      dueMonth: draft.item.month,
      status: draft.status,
      amountInr: amount,
      fundsAddedOn: draft.fundsAddedOn || null,
      retryOn: draft.retryOn || null,
      clearedOn: draft.clearedOn || null,
      feeInr: fee,
      fineInr: fine,
      note: draft.note,
    };
    const ok = await run(() => saveEmi(supabase, organizationId, input));
    if (ok) setEmiForm(null);
  }

  function markPaid(item: EmiMonth) {
    if (!window.confirm(`Mark ${monthLabel(item.month)} EMI of ${formatInr(item.amountInr)} as paid and cleared today?`)) return;
    void submitEmi(emiDraft(item, "cleared", today));
  }

  async function changeReminder(days: number) {
    await run(() => saveEmiReminderDays(supabase, organizationId, days));
  }

  function sendReminder() {
    const text = emiReminderText(alerts, busName);
    window.open(`https://wa.me/${org.whatsappNumber}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  const loanFormCard = loanForm ? (
    <Card title={loanForm.id ? "Change loan" : "Add a loan"}>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[13px] font-semibold">Buses on this loan</legend>
        <div className="flex flex-wrap gap-2">
          {myBuses.map((bus) => {
            const on = loanForm.busIds.includes(bus.id);
            return (
              <label
                key={bus.id}
                className={`flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold ${on ? "bg-brand text-white" : "bg-canvas"}`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() =>
                    setLoanForm({
                      ...loanForm,
                      busIds: on ? loanForm.busIds.filter((id) => id !== bus.id) : [...loanForm.busIds, bus.id],
                    })
                  }
                />
                {bus.registrationNumber}
              </label>
            );
          })}
        </div>
        {loanForm.busIds.length > 1 ? (
          <p className="text-xs text-muted">The EMI is split equally between these buses in the reports.</p>
        ) : null}
      </fieldset>
      <div className="grid gap-3 md:grid-cols-2">
        <label className={LABEL}>
          Bank or lender
          <input className={FIELD} value={loanForm.lender} onChange={(event) => setLoanForm({ ...loanForm, lender: event.target.value })} placeholder="e.g. HDFC" />
        </label>
        <label className={LABEL}>
          Loan number (last digits)
          <input className={FIELD} value={loanForm.loanRef} onChange={(event) => setLoanForm({ ...loanForm, loanRef: event.target.value })} placeholder="Optional" />
        </label>
        <label className={LABEL}>
          Account the EMI is taken from
          <input
            className={FIELD}
            value={loanForm.debitAccount}
            onChange={(event) => setLoanForm({ ...loanForm, debitAccount: event.target.value })}
            placeholder="e.g. Company current account"
          />
        </label>
        <label className={LABEL}>
          Monthly EMI (₹)
          <input className={FIELD} inputMode="numeric" value={loanForm.emi} onChange={(event) => setLoanForm({ ...loanForm, emi: event.target.value })} />
        </label>
        <label className={LABEL}>
          Auto-sweep day of the month
          <select
            className={FIELD}
            value={loanForm.sweepDay}
            onChange={(event) => {
              const sweepDay = event.target.value;
              // A new loan starts from the next EMI still to come.
              const firstMonth = loanForm.id ? loanForm.firstMonth : nextEmiMonth(Number(sweepDay), today).slice(0, 7);
              setLoanForm({ ...loanForm, sweepDay, firstMonth });
            }}
          >
            {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          First EMI to track
          <input type="month" className={FIELD} value={loanForm.firstMonth} onChange={(event) => setLoanForm({ ...loanForm, firstMonth: event.target.value })} />
        </label>
        <label className={LABEL}>
          Last EMI (end date)
          <input type="month" className={FIELD} value={loanForm.lastMonth} onChange={(event) => setLoanForm({ ...loanForm, lastMonth: event.target.value })} />
        </label>
        <label className={LABEL}>
          Note
          <input className={FIELD} value={loanForm.note} onChange={(event) => setLoanForm({ ...loanForm, note: event.target.value })} placeholder="Optional" />
        </label>
      </div>
      <ErrorText message={formError} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY} disabled={saving} onClick={() => void submitLoan()}>
          {saving ? "Saving…" : loanForm.id ? "Save changes" : "Save loan"}
        </button>
        <button type="button" className={SECONDARY} onClick={() => setLoanForm(null)}>
          Cancel
        </button>
      </div>
    </Card>
  ) : null;

  const emiFormCard = emiForm ? (
    <Card title={`${busesOf(emiForm.item.loan, busName)} · ${monthLabel(emiForm.item.month)} EMI`}>
      <div className="grid gap-3 md:grid-cols-2">
        <label className={LABEL}>
          Status
          <select
            className={FIELD}
            value={emiForm.status}
            onChange={(event) => {
              const status = event.target.value as EmiStatus;
              setEmiForm({
                ...emiForm,
                status,
                clearedOn: status === "cleared" && !emiForm.clearedOn ? today : emiForm.clearedOn,
                fundsAddedOn: status === "funds_added" && !emiForm.fundsAddedOn ? today : emiForm.fundsAddedOn,
              });
            }}
          >
            {(Object.keys(EMI_STATUS_LABELS) as EmiStatus[]).map((status) => (
              <option key={status} value={status}>
                {EMI_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          EMI amount (₹)
          <input className={FIELD} inputMode="numeric" value={emiForm.amount} onChange={(event) => setEmiForm({ ...emiForm, amount: event.target.value })} />
        </label>
        {emiForm.status !== "due" ? (
          <>
            <label className={LABEL}>
              Date money was added
              <input type="date" className={FIELD} value={emiForm.fundsAddedOn} onChange={(event) => setEmiForm({ ...emiForm, fundsAddedOn: event.target.value })} />
            </label>
            <label className={LABEL}>
              New sweep or payment date
              <input type="date" className={FIELD} value={emiForm.retryOn} onChange={(event) => setEmiForm({ ...emiForm, retryOn: event.target.value })} />
            </label>
          </>
        ) : null}
        {emiForm.status === "cleared" ? (
          <label className={LABEL}>
            Cleared from bank on
            <input type="date" className={FIELD} value={emiForm.clearedOn} onChange={(event) => setEmiForm({ ...emiForm, clearedOn: event.target.value })} />
          </label>
        ) : null}
        <label className={LABEL}>
          Bounce or late fee (₹)
          <input className={FIELD} inputMode="numeric" value={emiForm.fee} onChange={(event) => setEmiForm({ ...emiForm, fee: event.target.value })} placeholder="0" />
        </label>
        <label className={LABEL}>
          Penal interest or fine (₹)
          <input className={FIELD} inputMode="numeric" value={emiForm.fine} onChange={(event) => setEmiForm({ ...emiForm, fine: event.target.value })} placeholder="0" />
        </label>
        <label className={`${LABEL} md:col-span-2`}>
          {emiForm.status === "missed" ? "Why was it missed?" : "Note"}
          <input className={FIELD} value={emiForm.note} onChange={(event) => setEmiForm({ ...emiForm, note: event.target.value })} placeholder={emiForm.status === "missed" ? "e.g. Low balance" : "Optional"} />
        </label>
      </div>
      <p className="text-xs text-muted">
        Once cleared, the EMI is added to Company costs on this loan&apos;s buses, and fees and fines as a separate
        Bank fees &amp; fines cost. You can still change them there.
      </p>
      <ErrorText message={formError} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY} disabled={saving} onClick={() => void submitEmi(emiForm)}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className={SECONDARY} onClick={() => setEmiForm(null)}>
          Cancel
        </button>
        {emiForm.item.record ? (
          <button
            type="button"
            className="h-12 px-3 text-sm font-semibold text-muted"
            onClick={async () => {
              if (!window.confirm("Set this month back to due? Its costs in Company costs are removed.")) return;
              const ok = await run(() => resetEmi(supabase, organizationId, emiForm.item.record!.id));
              if (ok) setEmiForm(null);
            }}
          >
            Set back to due
          </button>
        ) : null}
      </div>
    </Card>
  ) : null;

  function emiRow(item: EmiMonth, index: number) {
    const days = daysFrom(today, item.dueOn);
    const late = item.status !== "cleared" && (item.status === "missed" || days < -3);
    const chip = late && item.status === "due" ? "overdue" : item.status === "due" && days <= data.reminderDays ? "soon" : item.status;
    const chipText =
      item.status === "cleared"
        ? `Cleared ${item.record?.clearedOn ? dayLabel(item.record.clearedOn) : ""}`
        : late && item.status === "due"
          ? "Not cleared"
          : item.status === "due"
            ? days === 0
              ? "Sweeps today"
              : days < 0
                ? "Confirm cleared"
                : `In ${days} day${days === 1 ? "" : "s"}`
            : EMI_STATUS_LABELS[item.status];
    const fees = (item.record?.feeInr ?? 0) + (item.record?.fineInr ?? 0);
    return (
      <div key={item.month} className={`flex flex-col gap-2 py-3 ${index ? "border-t border-line" : ""}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">
              {monthLabel(item.month)} · {formatInr(item.amountInr)}
            </p>
            <p className="truncate text-xs text-muted">
              {[
                `Sweep ${dayLabel(item.dueOn)}`,
                item.record?.fundsAddedOn ? `money added ${dayLabel(item.record.fundsAddedOn)}` : "",
                fees ? `fees and fines ${formatInr(fees)}` : "",
                item.record?.note ?? "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <span className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${STATUS_CLASS[chip]}`}>{chipText}</span>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-1">
            {item.status !== "cleared" ? (
              <SmallButton tone="brand" onClick={() => markPaid(item)} disabled={saving}>
                Mark paid
              </SmallButton>
            ) : null}
            {item.status === "due" ? (
              <SmallButton onClick={() => setEmiForm(emiDraft(item, "missed", today))}>Missed</SmallButton>
            ) : null}
            {item.status === "missed" ? (
              <SmallButton onClick={() => setEmiForm(emiDraft(item, "funds_added", today))}>Funds added</SmallButton>
            ) : null}
            <SmallButton onClick={() => setEmiForm(emiDraft(item, item.status, today))}>Edit</SmallButton>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="EMI reminders"
        action={
          alerts.length ? (
            <button type="button" onClick={sendReminder} className="text-sm font-bold text-brand">
              Send on WhatsApp
            </button>
          ) : null
        }
      >
        {alerts.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {alerts.map((alert, index) => (
              <li key={index} className={`font-semibold ${ALERT_CLASS[alert.kind]}`}>
                {alert.kind === "overdue" ? "⚠ " : ""}
                {emiAlertText(alert, busName)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing to do: no EMI sweeps in the next {data.reminderDays} days.</p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>Remind</span>
          {isAdmin && canEdit ? (
            <select
              aria-label="Reminder days before the sweep"
              className="h-10 rounded-xl bg-canvas px-3 text-sm text-ink"
              value={data.reminderDays}
              disabled={saving}
              onChange={(event) => void changeReminder(Number(event.target.value))}
            >
              {Array.from({ length: 10 }, (_, index) => index + 1).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-bold text-ink">{data.reminderDays}</span>
          )}
          <span>days before each sweep, and again the day before.</span>
        </div>
      </Card>

      {error ? <ErrorText message={error} /> : null}
      {emiFormCard}
      {loanFormCard}
      {!loanForm && canEdit ? (
        <button
          type="button"
          className={PRIMARY}
          onClick={() => {
            setFormError("");
            setLoanForm(emptyLoan(myBuses[0]?.id ?? "", today));
          }}
          disabled={!myBuses.length}
        >
          Add a loan
        </button>
      ) : null}
      {!loanForm && !emiForm ? <ErrorText message={formError} /> : null}
      {loading ? <p className="text-muted">Loading…</p> : null}
      {!loading && loans.length === 0 ? (
        <p className="text-muted">No loans yet. Add a bus loan to get reminders before each EMI sweep.</p>
      ) : null}

      {loans.map((loan) => {
        const summary = loanSummary(loan, data.emis, today);
        const months = loanMonths(loan, data.emis);
        const horizon = addMonths(`${today.slice(0, 7)}-01`, 1);
        // Open months up to next month, the latest cleared one, and everything when asked.
        const lastCleared = [...months].reverse().find((item) => item.status === "cleared");
        const shown = showAll.has(loan.id)
          ? months
          : months.filter((item) => (item.status !== "cleared" && item.month <= horizon) || item === lastCleared);
        const nextOpen = months.find((item) => item.status !== "cleared");
        const list = shown.length ? shown : nextOpen ? [nextOpen] : [];
        return (
          <Card
            key={loan.id}
            title={`${busesOf(loan, busName)} · ${loan.lender}${loan.loanRef ? ` (${loan.loanRef})` : ""}`}
            action={
              summary.closed ? (
                <span className="rounded-full bg-canvas px-3 py-1 text-xs font-bold text-muted">Closed</span>
              ) : summary.endingSoon ? (
                <span className="rounded-full bg-warn-bg px-3 py-1 text-xs font-bold text-warn-ink">Ending soon</span>
              ) : null
            }
          >
            <div className="text-sm">
              <p>
                <span className="font-bold">{formatInr(loan.emiInr)}</span> on the {loan.sweepDay}
                {ordinal(loan.sweepDay)} of each month{loan.debitAccount ? ` from ${loan.debitAccount}` : ""}
              </p>
              <p className="text-muted">
                {summary.left} of {summary.total} EMIs left · {formatInr(summary.moneyLeft)} to pay · last EMI{" "}
                {monthLabel(loan.lastMonth)}
                {summary.feesThisYear ? ` · fees and fines this year ${formatInr(summary.feesThisYear)}` : ""}
              </p>
            </div>
            <div>{list.map(emiRow)}</div>
            <div className="flex flex-wrap gap-1">
              <SmallButton
                tone="brand"
                onClick={() =>
                  setShowAll((current) => {
                    const next = new Set(current);
                    if (next.has(loan.id)) next.delete(loan.id);
                    else next.add(loan.id);
                    return next;
                  })
                }
              >
                {showAll.has(loan.id) ? "Show fewer months" : `Show all ${months.length} months`}
              </SmallButton>
              {canEdit ? (
                <>
                  <SmallButton
                    onClick={() => {
                      setFormError("");
                      setLoanForm(loanDraft(loan));
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    Change loan
                  </SmallButton>
                  <SmallButton
                    onClick={() => {
                      if (!window.confirm("Delete this loan and its EMI records? EMIs already paid stay in Company costs.")) return;
                      void run(() => deleteLoan(supabase, organizationId, loan.id));
                    }}
                  >
                    Delete
                  </SmallButton>
                </>
              ) : null}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function busesOf(loan: Loan, busName: (id: string) => string) {
  return loan.busIds.map(busName).join(" + ");
}

function ordinal(day: number) {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][day % 10] ?? "th";
}
