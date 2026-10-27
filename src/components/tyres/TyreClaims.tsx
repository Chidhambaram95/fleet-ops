"use client";

import Link from "next/link";
import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelClaim, closeClaim, moveTyre, raiseClaim } from "@data/tyres/repository";
import { formatInr, todayInIst } from "@domain/operations/totals";
import { kmSoFar, kmText, warrantyEndsOn, warrantyState } from "@domain/tyres/calc";
import { positionLabel } from "@domain/tyres/catalog";
import type { Tyre, TyreClaim, TyreClaimStatus } from "@domain/tyres/types";
import {
  Card,
  ErrorText,
  FIELD,
  LABEL,
  PRIMARY,
  SECONDARY,
  SmallButton,
  messageFromUnknown,
  shortDay,
  wholeNumber,
} from "@/components/ui/kit";

export const CLAIM_REASONS = [
  "Bulge or blister",
  "Sidewall cut or crack",
  "Tread separation",
  "Uneven or early wear",
  "Bead damage",
  "Other",
];

export const CLAIM_STATUS_LABELS: Record<TyreClaimStatus, string> = {
  pending: "Pending",
  replaced: "Replaced",
  credited: "Credit",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

function daysSince(date: string, today: string) {
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000));
}

/** One line on what the dealer did. */
export function claimOutcome(claim: TyreClaim, tyreNumber: (id: string | null) => string): string {
  switch (claim.status) {
    case "replaced":
      return `Replaced by ${tyreNumber(claim.replacementTyreId)}${claim.topUpInr ? `, top-up ${formatInr(claim.topUpInr)}` : ", free"}`;
    case "credited":
      return `${formatInr(claim.creditInr ?? 0)} credit${claim.creditBusLabel ? ` to ${claim.creditBusLabel}` : ""}`;
    case "rejected":
      return "Rejected by the dealer";
    case "cancelled":
      return "Claim withdrawn";
    default:
      return "Waiting for the dealer";
  }
}

/** Raise a warranty claim. A fitted tyre is taken off the bus first. */
export function ClaimForm({
  supabase,
  tyre,
  busName,
  odometer,
  onDone,
  onCancel,
}: {
  supabase: SupabaseClient;
  tyre: Tyre;
  busName: string;
  odometer: number | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const today = todayInIst();
  const fitted = tyre.status === "fitted";
  const [date, setDate] = useState(today);
  const [odo, setOdo] = useState(odometer != null ? String(odometer) : "");
  const [dealer, setDealer] = useState(tyre.vendor);
  const [reason, setReason] = useState(CLAIM_REASONS[0]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const km = kmSoFar(tyre, odometer);
  const state = warrantyState(tyre, km, today);
  const endsOn = warrantyEndsOn(tyre);

  async function save() {
    if (!date) return setError("Enter the date.");
    const reading = wholeNumber(odo);
    if (fitted && reading == null) return setError("Enter the odometer reading to take the tyre off.");
    setSaving(true);
    setError("");
    try {
      if (fitted) {
        await moveTyre(supabase, tyre.id, { kind: "removed", date, odometerKm: reading, reason: "Warranty claim" });
      }
      await raiseClaim(supabase, tyre.id, { date, dealer, reason, note });
      onDone();
    } catch (saveError) {
      setError(messageFromUnknown(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title={`Warranty claim · ${tyre.tyreNumber}`}>
      <p
        className={`rounded-2xl px-4 py-3 text-sm ${
          state === "over" ? "bg-[#fbe9e5] text-money-out" : "bg-brand-soft text-brand"
        }`}
      >
        {kmText(km)} run
        {tyre.warrantyKm ? ` of ${kmText(tyre.warrantyKm)} warranty` : ""}
        {endsOn ? `, warranty ${endsOn < today ? "ended" : "till"} ${shortDay(endsOn)}` : ""}.
        {state === "over" ? " The warranty looks over, but you can still ask the dealer." : ""}
        {state === "none" ? " No warranty was entered for this tyre." : ""}
      </p>
      {fitted ? (
        <p className="text-sm text-muted">
          It comes off {busName} · {positionLabel(tyre.currentPosition)} and waits with the dealer until they answer.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          Date
          <input type="date" className={FIELD} max={today} value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        {fitted ? (
          <label className={LABEL}>
            Odometer km
            <input inputMode="numeric" className={FIELD} value={odo} onChange={(event) => setOdo(event.target.value)} />
          </label>
        ) : null}
      </div>
      <label className={LABEL}>
        Dealer
        <input className={FIELD} placeholder="e.g. Sakthi Tyres" value={dealer} onChange={(event) => setDealer(event.target.value)} />
      </label>
      <label className={LABEL}>
        Problem
        <select className={FIELD} value={reason} onChange={(event) => setReason(event.target.value)}>
          {CLAIM_REASONS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        Note (optional)
        <input className={FIELD} placeholder="e.g. Claim slip number" value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <ErrorText message={error} />
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className={SECONDARY} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={PRIMARY} disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Raise claim"}
        </button>
      </div>
    </Card>
  );
}

type Outcome = "replaced" | "credited" | "rejected";

/** The dealer's answer to a pending claim. */
export function CloseClaimForm({
  supabase,
  claim,
  tyre,
  onDone,
  onCancel,
}: {
  supabase: SupabaseClient;
  claim: TyreClaim;
  tyre: Tyre | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const today = todayInIst();
  const [outcome, setOutcome] = useState<Outcome>("replaced");
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [newNumber, setNewNumber] = useState("");
  const [after, setAfter] = useState<"stock" | "pile">("stock");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!date) return setError("Enter the date.");
    const money = amount.trim() ? wholeNumber(amount) : null;
    if (amount.trim() && money == null) return setError("Enter the amount in rupees.");
    if (outcome === "credited" && !money) return setError("Enter the credit amount.");
    if (outcome === "replaced" && !newNumber.trim()) return setError("Enter the new tyre's number.");
    setSaving(true);
    setError("");
    try {
      await closeClaim(supabase, claim.id, {
        outcome,
        date,
        amountInr: outcome === "rejected" ? null : money,
        newTyreNumber: newNumber,
        after,
        note,
      });
      onDone();
    } catch (saveError) {
      setError(messageFromUnknown(saveError));
    } finally {
      setSaving(false);
    }
  }

  const choice = (active: boolean) =>
    `min-h-12 rounded-2xl px-2 text-sm font-bold ${active ? "bg-brand text-white" : "bg-canvas text-ink"}`;

  return (
    <Card title={`Dealer's answer · ${tyre?.tyreNumber ?? "Tyre"}`}>
      <p className="text-sm text-muted">
        Claimed {shortDay(claim.raisedOn)}
        {claim.dealer ? ` with ${claim.dealer}` : ""} · {claim.reason}
      </p>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[13px] font-semibold">What did the dealer do?</legend>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["replaced", "New tyre"],
              ["credited", "Credit"],
              ["rejected", "Rejected"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={outcome === id} className={choice(outcome === id)} onClick={() => setOutcome(id)}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          Date
          <input type="date" className={FIELD} min={claim.raisedOn} max={today} value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        {outcome === "replaced" ? (
          <label className={LABEL}>
            Top-up paid ₹
            <input inputMode="numeric" className={FIELD} placeholder="0 if free" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
        ) : outcome === "credited" ? (
          <label className={LABEL}>
            Credit amount ₹
            <input inputMode="numeric" className={FIELD} value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
        ) : null}
      </div>
      {outcome === "replaced" ? (
        <>
          <label className={LABEL}>
            New tyre number
            <input className={FIELD} value={newNumber} onChange={(event) => setNewNumber(event.target.value)} />
          </label>
          <p className="rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand">
            The dealer keeps {tyre?.tyreNumber}. The new tyre goes into stock as {[tyre?.brand, tyre?.size].filter(Boolean).join(" ") || "the same brand and size"}
            , priced at the top-up, which is charged to the first bus it is fitted on.
          </p>
        </>
      ) : null}
      {outcome === "credited" ? (
        <p className="rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand">
          The dealer keeps {tyre?.tyreNumber}. The credit is taken off the tyre cost of the bus that paid for it.
        </p>
      ) : null}
      {outcome === "rejected" ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[13px] font-semibold">The tyre goes</legend>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={after === "stock"} className={choice(after === "stock")} onClick={() => setAfter("stock")}>
              Back to stock
            </button>
            <button type="button" aria-pressed={after === "pile"} className={choice(after === "pile")} onClick={() => setAfter("pile")}>
              Scrap pile
            </button>
          </div>
        </fieldset>
      ) : null}
      <label className={LABEL}>
        Note (optional)
        <input className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <ErrorText message={error} />
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className={SECONDARY} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={PRIMARY} disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Card>
  );
}

/** Claims waiting on the dealer, and the latest settled ones. */
export function ClaimsCard({
  supabase,
  claims,
  tyres,
  tyreHref,
  readOnly,
  onAnswer,
  onChanged,
}: {
  supabase: SupabaseClient;
  claims: TyreClaim[];
  tyres: Tyre[];
  tyreHref: (tyre: Tyre) => string;
  readOnly: boolean;
  onAnswer: (claim: TyreClaim) => void;
  onChanged: () => void;
}) {
  const [error, setError] = useState("");
  const today = todayInIst();
  const tyreOf = (id: string | null) => tyres.find((tyre) => tyre.id === id) ?? null;
  const tyreNumber = (id: string | null) => tyreOf(id)?.tyreNumber ?? "a new tyre";
  const pending = claims.filter((claim) => claim.status === "pending");
  const settled = claims.filter((claim) => claim.status !== "pending" && claim.status !== "cancelled").slice(0, 10);

  async function withdraw(claim: TyreClaim) {
    if (!window.confirm(`Withdraw the claim on ${tyreNumber(claim.tyreId)}? It goes back to stock.`)) return;
    setError("");
    try {
      await cancelClaim(supabase, claim.id);
      onChanged();
    } catch (actionError) {
      setError(messageFromUnknown(actionError));
    }
  }

  const row = (claim: TyreClaim, index: number) => {
    const tyre = tyreOf(claim.tyreId);
    return (
      <div key={claim.id} className={`flex items-center justify-between gap-3 py-3 ${index ? "border-t border-line" : ""}`}>
        {tyre ? (
          <Link href={tyreHref(tyre)} className="min-w-0 grow">
            <p className="truncate font-semibold">
              {tyre.tyreNumber}
              <span className="font-normal text-muted"> · {claim.reason}</span>
            </p>
            <p className="truncate text-xs text-muted">
              {claim.status === "pending"
                ? `${claim.dealer || "Dealer"} · ${daysSince(claim.raisedOn, today)} days waiting · ${kmText(claim.kmAtClaim)}`
                : `${shortDay(claim.closedOn ?? claim.raisedOn)} · ${claimOutcome(claim, tyreNumber)}`}
            </p>
          </Link>
        ) : null}
        {claim.status === "pending" && !readOnly ? (
          <div className="flex shrink-0 items-center gap-1">
            <SmallButton tone="brand" onClick={() => onAnswer(claim)}>
              Dealer answered
            </SmallButton>
            <SmallButton onClick={() => void withdraw(claim)}>Withdraw</SmallButton>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <ErrorText message={error} />
      <Card title={`Warranty claims${pending.length ? ` · ${pending.length} waiting` : ""}`}>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">No claims waiting. Tap a tyre and choose “Warranty claim” to raise one.</p>
        ) : (
          <div>{pending.map(row)}</div>
        )}
        {settled.length ? (
          <div className="mt-2 border-t border-line pt-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Settled</p>
            <div>{settled.map(row)}</div>
          </div>
        ) : null}
      </Card>
    </>
  );
}
