"use client";

import Link from "next/link";
import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sellScrap, setScrapPile, undoScrapSale } from "@data/tyres/repository";
import { formatInr, todayInIst } from "@domain/operations/totals";
import { kmText } from "@domain/tyres/calc";
import type { ScrapReceivedVia, Tyre, TyreScrapSale } from "@domain/tyres/types";
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

export const RECEIVED_VIA_LABELS: Record<ScrapReceivedVia, string> = {
  cash: "Cash",
  account: "Company account",
};

/** Sell the scrap pile, or part of it, in one go. */
export function ScrapSaleForm({
  supabase,
  pile,
  onDone,
  onCancel,
}: {
  supabase: SupabaseClient;
  pile: Tyre[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const today = todayInIst();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(pile.map((tyre) => tyre.id)));
  const [date, setDate] = useState(today);
  const [buyer, setBuyer] = useState("");
  const [amount, setAmount] = useState("");
  const [via, setVia] = useState<ScrapReceivedVia>("cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    const amountInr = wholeNumber(amount);
    if (!picked.size) return setError("Tick the tyres sold.");
    if (!date) return setError("Enter the date.");
    if (amountInr == null) return setError("Enter the amount received in rupees.");
    setSaving(true);
    setError("");
    try {
      await sellScrap(supabase, { tyreIds: [...picked], date, buyer, amountInr, receivedVia: via, note });
      onDone();
    } catch (saveError) {
      setError(messageFromUnknown(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Sell scrap tyres">
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1.5 text-[13px] font-semibold">
          Tyres sold ({picked.size} of {pile.length})
        </legend>
        <div className="flex max-h-64 flex-col overflow-y-auto rounded-2xl bg-canvas px-3 py-1">
          {pile.map((tyre) => (
            <label key={tyre.id} className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={picked.has(tyre.id)} onChange={() => toggle(tyre.id)} />
              <span className="font-semibold">{tyre.tyreNumber}</span>
              <span className="truncate text-muted">
                {[tyre.brand, tyre.retreadCount ? `R${tyre.retreadCount}` : "", kmText(tyre.totalKm)].filter(Boolean).join(" · ")}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          Date
          <input type="date" className={FIELD} max={today} value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className={LABEL}>
          Amount received ₹
          <input inputMode="numeric" className={FIELD} value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[13px] font-semibold">Received in</legend>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(RECEIVED_VIA_LABELS) as ScrapReceivedVia[]).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={via === id}
              onClick={() => setVia(id)}
              className={`min-h-12 rounded-2xl px-2 text-sm font-bold ${via === id ? "bg-brand text-white" : "bg-canvas text-ink"}`}
            >
              {RECEIVED_VIA_LABELS[id]}
            </button>
          ))}
        </div>
      </fieldset>
      <label className={LABEL}>
        Buyer (optional)
        <input className={FIELD} placeholder="e.g. Raja Scrap Traders" value={buyer} onChange={(event) => setBuyer(event.target.value)} />
      </label>
      <label className={LABEL}>
        Note (optional)
        <input className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <p className="rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand">
        The ticked tyres are marked scrapped. The money counts as company income, not for any one bus.
      </p>
      <ErrorText message={error} />
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className={SECONDARY} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={PRIMARY} disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save sale"}
        </button>
      </div>
    </Card>
  );
}

/** The Scrap tab: tyres waiting in the pile, and past scrap sales. */
export function ScrapSection({
  supabase,
  pile,
  sales,
  tyreHref,
  readOnly,
  admin,
  onSell,
  onChanged,
}: {
  supabase: SupabaseClient;
  pile: Tyre[];
  sales: TyreScrapSale[];
  tyreHref: (tyre: Tyre) => string;
  readOnly: boolean;
  admin: boolean;
  onSell: () => void;
  onChanged: () => void;
}) {
  const [error, setError] = useState("");
  const yearStart = `${todayInIst().slice(0, 4)}-01-01`;
  const thisYear = sales.filter((sale) => sale.soldOn >= yearStart);

  async function takeBack(tyre: Tyre) {
    setError("");
    try {
      await setScrapPile(supabase, tyre.id, false);
      onChanged();
    } catch (actionError) {
      setError(messageFromUnknown(actionError));
    }
  }

  async function undo(sale: TyreScrapSale) {
    if (!window.confirm(`Undo the scrap sale of ${shortDay(sale.soldOn)}? The ${sale.tyreCount} tyres go back on the pile.`)) return;
    setError("");
    try {
      await undoScrapSale(supabase, sale.id);
      onChanged();
    } catch (actionError) {
      setError(messageFromUnknown(actionError));
    }
  }

  return (
    <>
      <ErrorText message={error} />
      <Card
        title={`Scrap pile${pile.length ? ` · ${pile.length} ${pile.length === 1 ? "tyre" : "tyres"}` : ""}`}
        action={
          !readOnly && pile.length ? (
            <button type="button" className="h-10 rounded-2xl bg-brand px-4 text-sm font-bold text-white" onClick={onSell}>
              Sell scrap
            </button>
          ) : null
        }
      >
        {pile.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing waiting. When you remove a worn tyre, choose “Scrap pile” and it collects here until you sell a batch.
          </p>
        ) : (
          <div>
            {pile.map((tyre, index) => (
              <div key={tyre.id} className={`flex items-center justify-between gap-3 py-3 ${index ? "border-t border-line" : ""}`}>
                <Link href={tyreHref(tyre)} className="min-w-0 grow">
                  <p className="truncate font-semibold">
                    {tyre.tyreNumber}
                    <span className="font-normal text-muted">{tyre.brand ? ` · ${tyre.brand}` : ""}</span>
                  </p>
                  <p className="truncate text-xs text-muted">
                    {[
                      kmText(tyre.totalKm),
                      tyre.retreadCount ? `retread ${tyre.retreadCount}×` : "",
                      tyre.scrapPileOn ? `since ${shortDay(tyre.scrapPileOn)}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </Link>
                {!readOnly ? <SmallButton onClick={() => void takeBack(tyre)}>Take back</SmallButton> : null}
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card
        title="Scrap sales"
        action={
          thisYear.length ? (
            <span className="text-xs text-muted">
              {formatInr(thisYear.reduce((total, sale) => total + sale.amountInr, 0))} this year
            </span>
          ) : null
        }
      >
        {sales.length === 0 ? (
          <p className="text-sm text-muted">No scrap sold yet.</p>
        ) : (
          <div>
            {sales.map((sale, index) => (
              <div key={sale.id} className={`flex items-center justify-between gap-3 py-3 ${index ? "border-t border-line" : ""}`}>
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {shortDay(sale.soldOn)}
                    <span className="font-normal text-muted">
                      {" "}
                      · {sale.tyreCount} {sale.tyreCount === 1 ? "tyre" : "tyres"}
                      {sale.buyer ? ` · ${sale.buyer}` : ""}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted">
                    {RECEIVED_VIA_LABELS[sale.receivedVia]}
                    {sale.note ? ` · ${sale.note}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="font-bold text-money-in">{formatInr(sale.amountInr)}</span>
                  {admin && !readOnly ? <SmallButton onClick={() => void undo(sale)}>Undo</SmallButton> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
