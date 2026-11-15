"use client";

import { useMemo, useState, useEffect } from "react";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import { latestOdometers } from "@data/tyres/repository";
import { dailySummaryCsv, dailySummaryFilename, formatWhatsAppDailySummary } from "@domain/operations/dailySummary";
import { whatsAppSendUrl } from "@domain/platform/whatsapp";
import { isTodayInIst, todayInIst, totalsByBus, totalsForEntries } from "@domain/operations/totals";
import { type Bus, type DailyEntry } from "@domain/operations/types";
import { type ModuleId } from "@domain/modules/modules";
import { downloadTextFile } from "@/lib/downloadTextFile";
import { useSession } from "@/components/billing/OrgContext";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { friendlyErrorMessage } from "@domain/platform/errors";
import { canManage } from "@domain/rbac/roles";

/** The day book's data and actions: the day's buses and entries, totals, and what this person may do. */
export function useDayBook(module?: ModuleId) {
  // Who is signed in comes from the server layout; it is not looked up again here.
  const org = useSession();
  const { organizationId, role, assignedBusId } = org;
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const repo = useMemo(() => createSupabaseOperationsRepository(supabase), [supabase]);
  const [date, setDate] = useState(todayInIst);
  const [busId, setBusId] = useState(role === "crew" ? assignedBusId : "");
  const [buses, setBuses] = useState<Bus[]>([]);
  const [allEntries, setEntries] = useState<DailyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dayLocked, setDayLocked] = useState(false);
  // Crew see only what they just saved, never the day's totals or entries.
  const [lastSaved, setLastSaved] = useState("");
  const [odometers, setOdometers] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!organizationId) {
      return;
    }

    let cancelled = false;

    async function loadBuses() {
      try {
        const listed = await repo.listBuses(organizationId);
        const nextBuses = module ? listed.filter((bus) => bus.busType === module) : listed;
        if (cancelled) {
          return;
        }
        setBuses(nextBuses);
        setBusId((current) => {
          if (role === "crew") {
            return assignedBusId || current;
          }
          return current || nextBuses[0]?.id || "";
        });
      } catch (loadError) {
        if (!cancelled) {
          setError(friendlyErrorMessage(loadError));
        }
      }
    }

    void loadBuses();
    return () => {
      cancelled = true;
    };
  }, [repo, organizationId, role, assignedBusId, module]);

  useEffect(() => {
    if (!organizationId || !role) {
      return;
    }
    if (role === "crew") {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadEntriesForDate() {
      setLoading(true);
      setError("");
      setEntries([]);
      try {
        const nextEntries = await repo.listEntriesByDate(organizationId, date);
        if (cancelled) {
          return;
        }
        setEntries(nextEntries);
      } catch (loadError) {
        if (!cancelled) {
          setError(friendlyErrorMessage(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadEntriesForDate();
    return () => {
      cancelled = true;
    };
  }, [repo, organizationId, role, date]);

  useEffect(() => {
    if (!organizationId || !role || role === "crew") {
      return;
    }
    let cancelled = false;
    latestOdometers(supabase, organizationId)
      .then((next) => {
        if (!cancelled) setOdometers(next);
      })
      .catch(() => {
        // The bus cards still work without the km.
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, organizationId, role]);

  const entries = useMemo(() => {
    if (!module) return allEntries;
    const ids = new Set(buses.map((bus) => bus.id));
    return allEntries.filter((entry) => ids.has(entry.busId));
  }, [allEntries, buses, module]);
  const fleetTotals = useMemo(() => totalsForEntries(entries), [entries]);
  const busTotals = useMemo(
    () => totalsByBus(buses, entries),
    [buses, entries],
  );
  const crewLocked = role === "crew";
  const visibleBuses = crewLocked
    ? buses.filter((bus) => bus.id === assignedBusId)
    : buses;

  async function removeEntry(id: string) {
    if (!organizationId) {
      setError("You are not a member of an organization.");
      return;
    }
    const previous = allEntries;
    setEntries((current) => current.filter((entry) => entry.id !== id));
    setError("");
    try {
      await repo.removeEntry(organizationId, id);
    } catch (removeError) {
      setEntries(previous);
      setError(friendlyErrorMessage(removeError));
    }
  }

  function downloadCsv() {
    downloadTextFile(
      dailySummaryFilename(date, org.name),
      dailySummaryCsv({ buses, entries }),
      "text/csv;charset=utf-8",
    );
  }

  function sendToOperator() {
    const phone = org.whatsappNumber;
    const url = whatsAppSendUrl({
      text: formatWhatsAppDailySummary({ company: org.name, date, buses, entries }),
      phone,
      userAgent: navigator.userAgent,
    });
    window.open(url, "_blank");
  }

  const today = isTodayInIst(date);
  const canWrite = !org.viewOnly && !dayLocked;
  const canUndo = canManage(role) && canWrite;

  return {
    module,
    org,
    organizationId,
    role,
    assignedBusId,
    supabase,
    repo,
    date,
    setDate,
    busId,
    setBusId,
    buses,
    allEntries,
    setEntries,
    entries,
    loading,
    error,
    setError,
    dayLocked,
    setDayLocked,
    lastSaved,
    setLastSaved,
    odometers,
    fleetTotals,
    busTotals,
    crewLocked,
    visibleBuses,
    today,
    canWrite,
    canUndo,
    removeEntry,
    downloadCsv,
    sendToOperator,
  };
}


export type DayBook = ReturnType<typeof useDayBook>;
