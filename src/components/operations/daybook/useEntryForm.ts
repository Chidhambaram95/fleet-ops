"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { addOdometerReading } from "@data/operations/odometer";
import { categoryLabel, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@domain/operations/catalog";
import { expenseFromReceipt, receiptSchema } from "@domain/operations/receipt";
import { formatInr, todayInIst } from "@domain/operations/totals";
import { type DailyEntry, type EntryKind, type ExpenseCategory, type IncomeCategory } from "@domain/operations/types";
import { compressReceipt } from "@/lib/compressReceipt";
import { friendlyErrorMessage } from "@domain/platform/errors";
import { parseTypedNumber } from "@domain/platform/numbers";
import { useDismiss } from "@/components/ui/useDismiss";
import type { DayBook } from "./useDayBook";

/** The add-entry form: its fields, saving a money entry, and reading a bill from a photo. */
export function useEntryForm(book: DayBook) {
  const { organizationId, role, assignedBusId, supabase, repo, date, setDate, busId, buses, setEntries, setError, setLastSaved } = book;
  const [kind, setKind] = useState<EntryKind>("income");
  const [category, setCategory] = useState<string>("ticket_collection");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [dieselKm, setDieselKm] = useState("");
  const [dieselLitres, setDieselLitres] = useState("");
  const [fullTank, setFullTank] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sideAmountRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const addParam = searchParams.get("add");

  // The + tab and "Add entry" link land here as /?add=income.
  useEffect(() => {
    if (addParam !== "income" && addParam !== "expense") {
      return;
    }
    setKind(addParam);
    setCategory(addParam === "income" ? "ticket_collection" : "diesel");
    if (window.matchMedia("(min-width: 1024px)").matches) {
      sideAmountRef.current?.focus();
    } else {
      setSheetOpen(true);
    }
    router.replace(pathname, { scroll: false });
  }, [addParam, router, pathname]);

  const closeSheet = useCallback(() => setSheetOpen(false), []);
  useDismiss(sheetOpen, closeSheet);

  const categories = kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  function onKindChange(next: EntryKind) {
    setKind(next);
    setCategory(next === "income" ? "ticket_collection" : "diesel");
  }

  function openSheet(next: EntryKind) {
    onKindChange(next);
    setError("");
    setSheetOpen(true);
  }

  async function saveEntry() {
    const amountInr = Math.round(Number(amount));
    if (!organizationId) {
      setError("You are not a member of an organization.");
      return;
    }
    if (!busId || (role === "crew" && busId !== assignedBusId)) {
      setError(
        role === "crew"
          ? "You can only log cash for your assigned vehicle."
          : "Pick a bus.",
      );
      return;
    }
    if (!Number.isFinite(amountInr) || amountInr <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    // Diesel can carry the odometer and litres, for mileage.
    const isDiesel = kind === "expense" && category === "diesel";
    const litres = isDiesel && dieselLitres.trim() ? parseTypedNumber(dieselLitres) : null;
    const odometerKm = isDiesel && dieselKm.trim() ? parseTypedNumber(dieselKm) : null;
    if (litres != null && (!Number.isFinite(litres) || litres <= 0 || litres > 2000)) {
      setError("Enter the litres, for example 85.5.");
      return;
    }
    if (odometerKm != null && (!Number.isInteger(odometerKm) || odometerKm < 0)) {
      setError("Enter the odometer in km.");
      return;
    }
    if (isDiesel && fullTank && (litres == null || odometerKm == null)) {
      setError("For a full tank, enter both the odometer and the litres.");
      return;
    }

    const optimistic: DailyEntry = {
      id: `optimistic-${crypto.randomUUID()}`,
      busId,
      date,
      kind,
      category: category as IncomeCategory | ExpenseCategory,
      amountInr,
      note: note.trim(),
      createdAt: new Date().toISOString(),
    };

    setSaving(true);
    setError("");
    if (odometerKm != null) {
      // Saved as a reading too, so the database refuses a figure below the last one.
      try {
        await addOdometerReading(supabase, organizationId, busId, odometerKm);
      } catch (readingError) {
        setError(friendlyErrorMessage(readingError));
        setSaving(false);
        return;
      }
    }
    setSheetOpen(false);
    setEntries((current) => [optimistic, ...current]);
    setAmount("");
    setNote("");
    setDieselKm("");
    setDieselLitres("");
    setFullTank(false);

    try {
      const saved = await repo.addEntry(organizationId, {
        busId,
        date,
        kind,
        category: optimistic.category,
        amountInr,
        note: optimistic.note,
        ...(isDiesel && (litres != null || odometerKm != null) ? { litres, odometerKm, fullTank } : {}),
      });
      setEntries((current) =>
        current.map((entry) => (entry.id === optimistic.id ? saved : entry)),
      );
      const bus = buses.find((item) => item.id === saved.busId);
      setLastSaved(
        `Saved: ${categoryLabel(saved.kind, saved.category)} ${formatInr(saved.amountInr)}` +
          (bus ? ` for ${bus.registrationNumber}` : ""),
      );
    } catch (saveError) {
      setEntries((current) =>
        current.filter((entry) => entry.id !== optimistic.id),
      );
      setError(friendlyErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function scanReceipt(file: File) {
    setScanning(true);
    setError("");
    try {
      if (!organizationId) {
        setError("You are not a member of an organization.");
        return;
      }
      const image = await compressReceipt(file);
      const response = await fetch("/api/parse-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          image: image.base64,
          mediaType: image.mediaType,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Could not read that receipt.";
        setError(message);
        return;
      }
      const parsed = receiptSchema.safeParse(payload);
      if (!parsed.success) {
        setError("The receipt reading did not match the expected fields.");
        return;
      }
      const expense = expenseFromReceipt(parsed.data);
      if (Number(expense.amount) <= 0) {
        setError("The receipt amount was not a usable rupee value.");
        return;
      }
      setKind("expense");
      setCategory(expense.category);
      setAmount(expense.amount);
      setNote(expense.note);
      if (expense.date <= todayInIst()) {
        setDate(expense.date);
      }
      setSheetOpen(true);
    } catch (scanError) {
      setError(friendlyErrorMessage(scanError));
    } finally {
      setScanning(false);
    }
  }

  return {
    kind,
    onKindChange,
    category,
    setCategory,
    amount,
    setAmount,
    note,
    setNote,
    dieselKm,
    setDieselKm,
    dieselLitres,
    setDieselLitres,
    fullTank,
    setFullTank,
    saving,
    scanning,
    sheetOpen,
    setSheetOpen,
    sideAmountRef,
    categories,
    openSheet,
    saveEntry,
    scanReceipt,
  };
}


export type EntryFormState = ReturnType<typeof useEntryForm>;
