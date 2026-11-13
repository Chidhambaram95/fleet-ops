"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { addRenewal, listRenewals } from "@data/renewals/repository";
import { listBusVahanDetails, type BusVahanDetails } from "@data/roadTax/repository";
import { moduleHref, type ModuleId } from "@domain/modules/modules";
import { formatInr, todayInIst } from "@domain/operations/totals";
import type { Bus } from "@domain/operations/types";
import { currentRenewals, daysLeft, dueText } from "@domain/renewals/catalog";
import type { Renewal } from "@domain/renewals/types";
import {
  VAHAN_HOME_URL,
  buildVahanJob,
  missingForVahan,
  taxQuarterOptions,
  toVahanDate,
  vahanStartUrl,
  type TaxQuarter,
} from "@domain/roadTax/vahan";
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
  messageFromUnknown,
  shortDay,
  useLoaded,
  wholeNumber,
} from "@/components/ui/kit";

const READ_ONLY = "flex h-12 w-full min-w-0 items-center justify-between gap-2 rounded-2xl border border-dashed border-line bg-white px-4 text-base";

type Loaded = {
  buses: Bus[];
  details: Map<string, BusVahanDetails>;
  migrated: boolean;
  roadTax: Renewal[];
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <SmallButton
      tone="brand"
      disabled={!value}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : `Copy ${label}`}
    </SmallButton>
  );
}

export function PayRoadTaxPage({
  organizationId,
  module,
  isAdmin,
}: {
  organizationId: string;
  module: ModuleId;
  isAdmin: boolean;
}) {
  const org = useOrg();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const { data, loading, error, reload } = useLoaded<Loaded>(
    async () => {
      const [allBuses, vahan, renewals] = await Promise.all([
        createSupabaseOperationsRepository(supabase).listBuses(organizationId),
        listBusVahanDetails(supabase, organizationId),
        listRenewals(supabase, organizationId),
      ]);
      const buses = allBuses.filter((bus) => bus.busType === module);
      const ids = new Set(buses.map((bus) => bus.id));
      const roadTax = renewals.filter((renewal) => renewal.kind === "road_tax" && ids.has(renewal.busId ?? ""));
      return { buses, details: vahan.details, migrated: vahan.migrated, roadTax };
    },
    { buses: [], details: new Map(), migrated: true, roadTax: [] },
  );
  const today = todayInIst();
  const latest = useMemo(() => {
    const byBus = new Map<string, Renewal>();
    for (const renewal of currentRenewals(data.roadTax)) byBus.set(renewal.busId ?? "", renewal);
    return byBus;
  }, [data.roadTax]);

  const [busId, setBusId] = useState("");
  const [quarterIndex, setQuarterIndex] = useState(0);
  const [showManual, setShowManual] = useState(false);
  const [startError, setStartError] = useState("");
  const [started, setStarted] = useState(false);

  // A link from Documents due can name the bus: ?bus=<id>.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("bus");
    if (wanted) setBusId(wanted);
  }, []);
  useEffect(() => {
    if (!data.buses.length) return;
    if (!data.buses.some((bus) => bus.id === busId)) setBusId(data.buses[0].id);
  }, [data.buses, busId]);

  const bus = data.buses.find((item) => item.id === busId) ?? null;
  const details = (bus && data.details.get(bus.id)) || { ownerName: "", chassisLast5: "" };
  const missing = bus ? missingForVahan(details) : [];
  const last = bus ? (latest.get(bus.id) ?? null) : null;
  const quarters = useMemo(
    () => taxQuarterOptions(last?.expiresOn ?? null, today),
    [last?.expiresOn, today],
  );
  const quarter: TaxQuarter | null = quarters[quarterIndex] ?? quarters[0] ?? null;
  const ready = Boolean(bus && quarter && missing.length === 0 && data.migrated);

  function start() {
    if (!bus || !quarter || !ready) return;
    setStartError("");
    const job = buildVahanJob({
      registrationNumber: bus.registrationNumber,
      chassisLast5: details.chassisLast5,
      ownerName: details.ownerName,
      quarter,
      lastAmountInr: last?.amountInr ?? null,
    });
    window.open(vahanStartUrl(job), "_blank", "noopener");
    setStartError("");
    setStarted(true);
  }

  // Recording the payment after it is done on Vahan.
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [validTill, setValidTill] = useState("");
  const [receipt, setReceipt] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    setValidTill(quarter?.to ?? "");
    setSaved("");
  }, [quarter?.to, busId]);

  async function recordPayment() {
    if (!bus) return;
    const amountInr = wholeNumber(amount);
    if (amountInr == null || amountInr <= 0) return setSaveError("Enter the amount paid in rupees.");
    if (!validTill) return setSaveError("Enter the date the tax is now paid till.");
    if (!paidOn) return setSaveError("Enter the date you paid.");
    setSaving(true);
    setSaveError("");
    try {
      await addRenewal(supabase, organizationId, {
        busId: bus.id,
        personId: null,
        kind: "road_tax",
        permitType: "",
        expiresOn: validTill,
        amountInr,
        paidOn,
        photoPath: "",
        note: receipt.trim() ? `Vahan receipt ${receipt.trim()}` : "Paid on Vahan",
      });
      setSaved(`Saved: ${bus.registrationNumber} road tax paid till ${shortDay(validTill)}.`);
      setAmount("");
      setReceipt("");
      setQuarterIndex(0);
      reload();
    } catch (recordError) {
      setSaveError(messageFromUnknown(recordError));
    } finally {
      setSaving(false);
    }
  }

  const busesHref = moduleHref(module, "buses");
  const missingNote = bus && missing.length ? (
    <p className="rounded-2xl bg-warn-bg px-4 py-3 text-sm text-warn-ink">
      {bus.registrationNumber} has no {missing.join(" or ")} yet.{" "}
      {isAdmin ? (
        <Link href={busesHref} className="font-bold underline">
          Add it on the Buses page
        </Link>
      ) : (
        "Ask your admin to add it on the Buses page."
      )}
    </p>
  ) : null;

  const manualSteps = bus && quarter ? (
    <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
      <li>
        <a href={VAHAN_HOME_URL} target="_blank" rel="noopener noreferrer" className="font-bold text-brand underline">
          Open Vahan
        </a>{" "}
        and close the “Update Your Mobile Number” box.
      </li>
      <li>
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Vehicle number: <b>{bus.registrationNumber.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}</b>
          </span>
          <CopyButton value={bus.registrationNumber.replace(/[^A-Za-z0-9]/g, "").toUpperCase()} label="number" />
        </span>
        Tick “I accept…”, then Proceed, then Proceed again.
      </li>
      <li>Tax/Fee Services → Pay Your Tax.</li>
      <li>
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Chassis last 5: <b>{details.chassisLast5 || "not added"}</b>
          </span>
          <CopyButton value={details.chassisLast5} label="chassis" />
        </span>
        VERIFY DETAILS, then Submit.
      </li>
      <li>Tax Mode: QUARTERLY. Then Payment.</li>
      <li className="rounded-2xl bg-brand-soft p-3">
        <b>Before Confirm Payment, check:</b>
        <br />
        Owner Name is <b>{details.ownerName || "not added"}</b>
        <br />
        Period is <b>{toVahanDate(quarter.from)}</b> to <b>{toVahanDate(quarter.to)}</b>
        <br />
        If either is different, click Cancel and do not pay.
      </li>
    </ol>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Pay road tax on Vahan"
        hint="Pick the bus and the quarter. Fleet Ops fills Vahan in and stops before Confirm Payment so you can check and pay."
        action={
          <Link href={moduleHref(module, "renewals")} className={`${SECONDARY} inline-flex items-center`}>
            Back to Documents due
          </Link>
        }
      />
      <ErrorText message={error} />
      {!data.migrated ? (
        <p className="rounded-2xl bg-warn-bg px-4 py-3 text-sm text-warn-ink">
          Run migration 0028 on the database first. It adds the owner name and chassis number to each bus.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[1fr_380px] md:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            {loading ? <p className="text-muted">Loading…</p> : null}
            {!loading && data.buses.length === 0 ? (
              <p className="text-muted">Add buses on the Buses page first.</p>
            ) : null}
            {data.buses.length ? (
              <>
                <label className={LABEL}>
                  Vehicle number
                  <select
                    className={FIELD}
                    value={busId}
                    onChange={(event) => {
                      setBusId(event.target.value);
                      setQuarterIndex(0);
                      setStarted(false);
                    }}
                  >
                    {data.buses.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.registrationNumber}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={LABEL}>
                  Chassis (last 5)
                  <div className={READ_ONLY}>
                    <span>{details.chassisLast5 || <span className="text-muted">Not added</span>}</span>
                    <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">from bus record</span>
                  </div>
                </div>
                <div className={LABEL}>
                  Owner name (as on RC)
                  <div className={READ_ONLY}>
                    <span className="truncate">{details.ownerName || <span className="text-muted">Not added</span>}</span>
                    <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">from bus record</span>
                  </div>
                </div>
                {missingNote}
                <label className={LABEL}>
                  Tax quarter
                  <select
                    className={FIELD}
                    value={quarterIndex}
                    onChange={(event) => setQuarterIndex(Number(event.target.value))}
                  >
                    {quarters.map((item, index) => (
                      <option key={item.from} value={index}>
                        {item.label} ({toVahanDate(item.from)} to {toVahanDate(item.to)}){index === 0 ? " · next due" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="-mt-1 text-xs text-muted">
                  {last
                    ? `Road tax is paid till ${shortDay(last.expiresOn)}, so the next quarter starts ${shortDay(quarters[0].from)}.`
                    : "No road tax saved for this bus yet, so this starts from the current quarter."}{" "}
                  Vahan takes one quarter at a time, always the next unpaid one.
                </p>

                <div className="hidden flex-col gap-2 md:flex">
                  <button type="button" className={PRIMARY} disabled={!ready} onClick={start}>
                    Start on Vahan →
                  </button>
                  <ErrorText message={startError} />
                  {started ? (
                    <p className="text-center text-sm text-money-in">
                      Vahan opened in a new tab. If it shows no “Fleet Ops helper” box, the helper is not installed.
                    </p>
                  ) : null}
                  <p className="text-center text-xs text-muted">
                    Needs the Fleet Ops Vahan helper in Chrome. You click Confirm Payment and pay in Vahan yourself.
                  </p>
                  <button
                    type="button"
                    className="self-center text-[13px] font-semibold text-brand"
                    onClick={() => setShowManual((open) => !open)}
                  >
                    {showManual ? "Hide the by-hand steps" : "Or fill Vahan in by hand"}
                  </button>
                  {showManual ? manualSteps : null}
                </div>
              </>
            ) : null}
          </Card>

          {bus && quarter ? (
            <div className="md:hidden">
              <Card title="Pay on Vahan from this phone">
                <p className="text-sm text-muted">
                  The automatic helper needs Chrome on a laptop. On a phone, follow these steps; copy buttons fill the
                  boxes for you.
                </p>
                {manualSteps}
              </Card>
            </div>
          ) : null}

          {bus && quarter && !org.viewOnly ? (
            <Card title="After paying: record it">
              <p className="text-sm text-muted">
                Saves the road tax for {bus.registrationNumber} on Documents due, so the next reminder and quarter are right.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className={LABEL}>
                  Amount paid ₹
                  <input inputMode="numeric" className={FIELD} value={amount} onChange={(event) => setAmount(event.target.value)} />
                </label>
                <label className={LABEL}>
                  Paid on
                  <input type="date" className={FIELD} value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
                </label>
                <label className={LABEL}>
                  Tax paid till
                  <input type="date" className={FIELD} value={validTill} onChange={(event) => setValidTill(event.target.value)} />
                </label>
                <label className={LABEL}>
                  Receipt no. (optional)
                  <input className={FIELD} value={receipt} onChange={(event) => setReceipt(event.target.value)} />
                </label>
              </div>
              <ErrorText message={saveError} />
              {saved ? <p className="text-sm font-semibold text-money-in">{saved}</p> : null}
              <button type="button" className={PRIMARY} disabled={saving} onClick={recordPayment}>
                {saving ? "Saving…" : "Save payment"}
              </button>
            </Card>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4 md:sticky md:top-24">
          <Card title="Road tax status">
            {data.buses.map((item, index) => {
              const current = latest.get(item.id);
              const days = current ? daysLeft(current.expiresOn, today) : null;
              const itemMissing = missingForVahan(data.details.get(item.id) ?? { ownerName: "", chassisLast5: "" });
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer text-left"
                  onClick={() => {
                    setBusId(item.id);
                    setQuarterIndex(0);
                    setStarted(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setBusId(item.id);
                      setQuarterIndex(0);
                      setStarted(false);
                    }
                  }}
                >
                  <ListRow
                    first={index === 0}
                    title={`${item.id === busId ? "▸ " : ""}${item.registrationNumber}`}
                    detail={
                      current
                        ? `Paid till ${shortDay(current.expiresOn)}${current.amountInr != null ? ` · last ${formatInr(current.amountInr)}` : ""}`
                        : "No road tax saved"
                    }
                    amount={
                      itemMissing.length ? (
                        <span className="whitespace-nowrap rounded-full bg-warn-bg px-3 py-1 text-xs text-warn-ink">Add details</span>
                      ) : days != null ? (
                        <span
                          className={`whitespace-nowrap rounded-full px-3 py-1 text-xs ${
                            days < 0 ? "bg-money-out text-white" : days <= 30 ? "bg-warn-bg text-warn-ink" : "bg-brand-soft text-brand"
                          }`}
                        >
                          {dueText(days)}
                        </span>
                      ) : undefined
                    }
                  />
                </div>
              );
            })}
          </Card>
          <Card title="Fleet Ops Vahan helper">
            <p className="text-sm text-muted">
              A small Chrome extension, set up once per laptop. It only works on vahan.parivahan.gov.in, fills in the
              bus and quarter, checks the owner name and period, and stops before Confirm Payment.
            </p>
            <p className="text-sm text-muted">
              To install: chrome://extensions → Developer mode → Load unpacked → pick the{" "}
              <code>extensions/vahan-helper</code> folder of Fleet Ops.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
