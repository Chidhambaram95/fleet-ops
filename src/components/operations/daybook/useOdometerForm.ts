"use client";

import { useState } from "react";
import { addOdometerReading } from "@data/operations/odometer";
import { friendlyErrorMessage } from "@domain/platform/errors";
import { parseTypedNumber } from "@domain/platform/numbers";
import type { DayBook } from "./useDayBook";

/** The crew odometer form: the km typed in and saving it as a reading for the bus. */
export function useOdometerForm(book: DayBook) {
  const { organizationId, supabase, busId, buses, setLastSaved } = book;
  const [odometerKm, setOdometerKm] = useState("");
  const [odometerSaving, setOdometerSaving] = useState(false);
  const [odometerError, setOdometerError] = useState("");

  async function saveOdometer() {
    const km = parseTypedNumber(odometerKm);
    if (!organizationId || !busId) {
      setOdometerError("No bus is given to you yet. Ask your admin.");
      return;
    }
    if (!odometerKm.trim() || !Number.isInteger(km) || km < 0) {
      setOdometerError("Enter the odometer in km.");
      return;
    }
    setOdometerSaving(true);
    setOdometerError("");
    try {
      await addOdometerReading(supabase, organizationId, busId, km);
      const bus = buses.find((item) => item.id === busId);
      setLastSaved(
        `Saved: odometer ${km.toLocaleString("en-IN")} km` +
          (bus ? ` for ${bus.registrationNumber}` : ""),
      );
      setOdometerKm("");
    } catch (saveError) {
      setOdometerError(friendlyErrorMessage(saveError));
    } finally {
      setOdometerSaving(false);
    }
  }

  return { odometerKm, setOdometerKm, odometerSaving, odometerError, saveOdometer };
}


export type OdometerFormState = ReturnType<typeof useOdometerForm>;
