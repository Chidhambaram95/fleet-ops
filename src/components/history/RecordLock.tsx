"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { closeDay, getDayLock, getTripLock, lastChange, openForEdit } from "@data/history/repository";
import { changedAtLabel, changedByLabel, changeTitle } from "@domain/history/describe";
import type { HistoryRow } from "@domain/history/types";
import { friendlyErrorMessage } from "@domain/platform/errors";
import type { UserRole } from "@domain/rbac/roles";

type Target = { day: string } | { tripId: string };

function canOpen(role: UserRole | null) {
  return role === "admin" || role === "manager";
}

function timeLabel(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

/**
 * Shows when a day (or a trip sheet) is closed. Admins and managers can open
 * it for 30 minutes with a comment, or close today's day early.
 * `onLockedChange` tells the screen whether this person can edit right now.
 */
export function RecordLock({
  supabase,
  organizationId,
  target,
  role,
  onLockedChange,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  target: Target;
  role: UserRole | null;
  onLockedChange?: (locked: boolean) => void;
}) {
  const day = "day" in target ? target.day : "";
  const tripId = "tripId" in target ? target.tripId : "";
  const [frozen, setFrozen] = useState(false);
  const [closedEarly, setClosedEarly] = useState(false);
  const [openUntil, setOpenUntil] = useState<string | null>(null);
  const [step, setStep] = useState<"" | "open" | "close">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!organizationId || (!day && !tripId)) return;
    try {
      if (tripId) {
        const lock = await getTripLock(supabase, organizationId, tripId);
        setFrozen(lock.frozen);
        setClosedEarly(false);
        setOpenUntil(lock.openUntil);
      } else {
        const lock = await getDayLock(supabase, organizationId, day);
        setFrozen(lock.frozen);
        setClosedEarly(lock.closed);
        setOpenUntil(lock.openUntil);
      }
    } catch {
      // Without the status the database still refuses closed records.
      setFrozen(false);
      setOpenUntil(null);
    }
  }, [supabase, organizationId, day, tripId]);

  useEffect(() => {
    setStep("");
    setReason("");
    setError("");
    void load();
  }, [load]);

  const open = Boolean(openUntil && new Date(openUntil).getTime() > Date.now());
  const locked = frozen && !open;

  useEffect(() => {
    onLockedChange?.(locked);
  }, [locked, onLockedChange]);

  // The 30 minutes run out while the screen is open.
  useEffect(() => {
    if (!openUntil) return;
    const wait = new Date(openUntil).getTime() - Date.now();
    if (wait <= 0) return;
    const timer = window.setTimeout(() => void load(), Math.min(wait + 500, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [openUntil, load]);

  async function submitOpen() {
    if (reason.trim().length < 3) {
      setError("Write a short comment on why this needs a change.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const until = await openForEdit(supabase, organizationId, tripId ? { tripId } : { day }, reason.trim());
      setOpenUntil(until);
      setStep("");
      setReason("");
    } catch (openError) {
      setError(friendlyErrorMessage(openError));
    } finally {
      setBusy(false);
    }
  }

  async function submitClose() {
    setBusy(true);
    setError("");
    try {
      await closeDay(supabase, organizationId, day);
      setStep("");
      await load();
    } catch (closeError) {
      setError(friendlyErrorMessage(closeError));
    } finally {
      setBusy(false);
    }
  }

  const what = tripId ? "trip sheet" : "day";
  const manager = canOpen(role);

  if (!frozen) {
    if (tripId || !manager) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {step === "close" ? (
          <>
            <span className="text-muted">Close this day? Changes after this need a comment.</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitClose()}
              className="min-h-10 rounded-full bg-ink px-4 font-bold text-white disabled:opacity-50"
            >
              {busy ? "Closing…" : "Yes, close it"}
            </button>
            <button type="button" className="min-h-10 px-2 font-semibold text-muted" onClick={() => setStep("")}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setStep("close")}
            className="min-h-10 rounded-full bg-white px-4 font-bold text-muted"
          >
            Close this day
          </button>
        )}
        {error ? <span className="font-semibold text-money-out">{error}</span> : null}
      </div>
    );
  }

  return (
    <section
      aria-label={`This ${what} is closed`}
      className={`flex flex-col gap-2 rounded-2xl px-4 py-3 text-sm ${open ? "bg-brand-soft text-brand-dark" : "bg-[#FFF4E0] text-[#7A4B00]"}`}
    >
      {open ? (
        <p className="font-semibold">
          Open for changes until {timeLabel(openUntil as string)}. Your changes are saved in Change history with
          your comment.
        </p>
      ) : (
        <p className="font-semibold">
          {closedEarly ? `This ${what} was closed early.` : `This ${what} is closed: it is more than 3 days old.`}{" "}
          {manager ? "To change it, open it with a comment." : "Ask your admin or manager to make a change."}
        </p>
      )}
      {!open && manager ? (
        step === "open" ? (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-[13px] font-semibold">
              Why does it need a change?
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Diesel bill was entered twice"
                className="h-11 rounded-xl bg-white px-3 text-base font-normal text-ink"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitOpen()}
                className="min-h-10 rounded-full bg-brand px-4 font-bold text-white disabled:opacity-50"
              >
                {busy ? "Opening…" : "Open for 30 minutes"}
              </button>
              <button type="button" className="min-h-10 px-2 font-semibold" onClick={() => setStep("")}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setStep("open")}
            className="min-h-10 self-start rounded-full bg-white px-4 font-bold text-ink"
          >
            Change with a comment
          </button>
        )
      ) : null}
      {error ? <p className="font-semibold text-money-out">{error}</p> : null}
    </section>
  );
}

/** "Last change: Ravi · 23 Oct, 4:05 pm". Shown to admins and managers. */
export function LastChangeLine({
  supabase,
  organizationId,
  target,
  refreshKey,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  target: { day: string; module?: string } | { tripId: string };
  /** Changes whenever the screen saves, so the line reloads. */
  refreshKey?: unknown;
}) {
  const [row, setRow] = useState<HistoryRow | null>(null);
  const key = "tripId" in target ? `t:${target.tripId}` : `d:${target.day}:${target.module ?? ""}`;

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      lastChange(supabase, organizationId, target)
        .then((next) => {
          if (!cancelled) setRow(next);
        })
        .catch(() => {
          if (!cancelled) setRow(null);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `target` is rebuilt on each render; `key` stands for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, organizationId, key, refreshKey]);

  if (!row) return null;
  return (
    <p className="text-center text-xs text-muted">
      Last change: {changeTitle(row).toLowerCase()} by {changedByLabel(row)} · {changedAtLabel(row.changedAt)}
      {row.reason ? ` · “${row.reason}”` : ""}
    </p>
  );
}
