"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import {
  deleteTrip,
  getTrip,
  saveTrip,
  tripPhotoUrl,
  uploadTripPhoto,
  usualMileage,
} from "@data/trips/repository";
import { whatsAppSendUrl } from "@domain/operations/settlementExport";
import { hasScreen, moduleHref, type ModuleId } from "@domain/modules/modules";
import { formatInr } from "@domain/operations/totals";
import type { Bus } from "@domain/operations/types";
import type { UserRole } from "@domain/rbac/roles";
import { TRIP_EXPENSE_CATEGORIES } from "@domain/trips/catalog";
import { settlementText, tripChecks, tripTotals } from "@domain/trips/checks";
import { tripSheetSchema } from "@domain/trips/tripSheet";
import type { Trip } from "@domain/trips/types";
import { formatTripWhatsApp } from "@domain/trips/whatsapp";
import { useOrg } from "@/components/billing/OrgContext";
import { compressReceipt } from "@/lib/compressReceipt";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import {
  EMPTY_DIESEL,
  emptyForm,
  figuresFromForm,
  formFromReading,
  formFromTrip,
  formProblem,
  tripInput,
  type TripForm,
} from "./tripForm";
import { friendlyErrorMessage } from "@domain/platform/errors";

const FIELD = "h-12 w-full min-w-0 rounded-2xl bg-canvas px-4 text-base disabled:opacity-70";
const LABEL = "flex min-w-0 flex-col gap-1.5 text-[13px] font-semibold";

function messageFromUnknown(error: unknown) {
  return friendlyErrorMessage(error);
}

type Step = "photo" | "reading" | "form";

export function TripEditor({
  organizationId,
  module,
  role,
  tripId,
}: {
  organizationId: string;
  module: ModuleId;
  role: UserRole;
  tripId?: string;
}) {
  const tripsHref = moduleHref(module, "trips");
  const org = useOrg();
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const operations = useMemo(() => createSupabaseOperationsRepository(supabase), [supabase]);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [form, setForm] = useState<TripForm>(emptyForm());
  const [step, setStep] = useState<Step>(tripId ? "form" : "photo");
  const [loading, setLoading] = useState(Boolean(tripId));
  const [photo, setPhoto] = useState<{ url: string; blob: Blob | null; path: string }>({
    url: "",
    blob: null,
    path: "",
  });
  const [fromPhoto, setFromPhoto] = useState(false);
  const [usual, setUsual] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);

  const approved = trip?.status === "approved";
  const isAdmin = role === "admin";
  const locked = org.viewOnly || (approved && !isAdmin);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const allBuses = await operations.listBuses(organizationId);
        if (cancelled) return;
        const moduleBuses = allBuses.filter((bus) => bus.busType === module);
        setBuses(moduleBuses);
        if (!tripId) {
          setForm(emptyForm(moduleBuses[0]?.id ?? ""));
          return;
        }
        const loaded = await getTrip(supabase, organizationId, tripId);
        if (cancelled) return;
        if (!loaded) {
          setError("This trip was not found. It may have been deleted.");
          return;
        }
        const tripBus = allBuses.find((item) => item.id === loaded.busId);
        if (tripBus && tripBus.busType !== module) {
          // A link from another module: open the trip in its bus's module.
          if (hasScreen(tripBus.busType, "trips")) {
            router.replace(`${moduleHref(tripBus.busType, "trips")}/${loaded.id}`);
            return;
          }
          setBuses([...moduleBuses, tripBus]);
        }
        setTrip(loaded);
        setForm(formFromTrip(loaded));
        if (loaded.photoPath) {
          const url = await tripPhotoUrl(supabase, loaded.photoPath).catch(() => "");
          if (!cancelled) setPhoto({ url, blob: null, path: loaded.photoPath });
        }
      } catch (loadError) {
        if (!cancelled) setError(messageFromUnknown(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [operations, organizationId, supabase, tripId, module, router]);

  useEffect(() => {
    if (!form.busId) {
      setUsual(null);
      return;
    }
    let cancelled = false;
    usualMileage(supabase, organizationId, form.busId, tripId)
      .then((value) => {
        if (!cancelled) setUsual(value);
      })
      .catch(() => {
        if (!cancelled) setUsual(null);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, organizationId, form.busId, tripId]);

  // Buses that run trips come first in the picker.
  const busOptions = useMemo(
    () =>
      [...buses].sort(
        (left, right) =>
          Number(left.busType === "town") - Number(right.busType === "town") ||
          left.registrationNumber.localeCompare(right.registrationNumber),
      ),
    [buses],
  );
  const figures = useMemo(() => figuresFromForm(form), [form]);
  const totals = useMemo(() => tripTotals(figures), [figures]);
  const checks = useMemo(() => tripChecks(figures, usual), [figures, usual]);
  const bus = buses.find((item) => item.id === form.busId);

  function set<K extends keyof TripForm>(key: K, value: TripForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setConfirmApprove(false);
  }

  async function readPhoto(file: File) {
    setError("");
    setStep("reading");
    try {
      const image = await compressReceipt(file, { maxEdge: 2000, quality: 0.75 });
      setPhoto({ url: URL.createObjectURL(image.blob), blob: image.blob, path: "" });
      const response = await fetch("/api/parse-trip-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          image: image.base64,
          mediaType: image.mediaType,
        }),
      });
      const payload: unknown = await response.json();
      const parsed = tripSheetSchema.safeParse(payload);
      if (!response.ok || !parsed.success) {
        const message =
          payload && typeof payload === "object" && "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "The sheet could not be read.";
        setError(`${message} Please type the details in.`);
        setStep("form");
        return;
      }
      setForm(formFromReading(parsed.data, buses, form.busId));
      setFromPhoto(true);
      setStep("form");
    } catch (readError) {
      setError(`${messageFromUnknown(readError)} Please type the details in.`);
      setStep("form");
    }
  }

  async function save(approve: boolean) {
    const problem = formProblem(form);
    if (problem) {
      setError(problem);
      return;
    }
    if (approve && checks.length > 0 && !confirmApprove) {
      setConfirmApprove(true);
      return;
    }
    setSaving(true);
    setError("");
    try {
      let photoPath = photo.path;
      if (!photoPath && photo.blob) {
        photoPath = await uploadTripPhoto(supabase, organizationId, photo.blob);
        setPhoto((current) => ({ ...current, path: photoPath }));
      }
      const id = await saveTrip(
        supabase,
        organizationId,
        tripInput(form, photoPath, trip?.id),
        approve && !approved,
      );
      if (tripId) {
        const reloaded = await getTrip(supabase, organizationId, id);
        if (reloaded) {
          setTrip(reloaded);
          setForm(formFromTrip(reloaded));
        }
      } else {
        router.replace(`${tripsHref}/${id}`);
      }
      setConfirmApprove(false);
      router.refresh();
    } catch (saveError) {
      setError(messageFromUnknown(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!trip || !window.confirm("Delete this trip? This can't be undone.")) {
      return;
    }
    try {
      await deleteTrip(supabase, organizationId, trip.id);
      router.replace(tripsHref);
      router.refresh();
    } catch (removeError) {
      setError(messageFromUnknown(removeError));
    }
  }

  function sendWhatsApp() {
    const current: Trip = {
      ...tripInput(form, photo.path),
      id: trip?.id ?? "",
      status: trip?.status ?? "draft",
      approvedAt: trip?.approvedAt ?? null,
      settledOn: trip?.settledOn ?? null,
    };
    const url = whatsAppSendUrl({
      text: formatTripWhatsApp({
        company: org.name,
        busNumber: bus?.registrationNumber ?? "",
        trip: current,
      }),
      phone: org.whatsappNumber,
      userAgent: navigator.userAgent,
    });
    window.open(url, "_blank");
  }

  if (loading) {
    return <p className="text-sm text-muted">Loading the trip…</p>;
  }

  if (step === "photo") {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <BackLink href={tripsHref} />
        <h1 className="text-2xl font-extrabold">New trip</h1>
        <p className="text-muted">
          Take a clear photo of the whole trip sheet. The app reads it and fills the
          form for you to check.
        </p>
        {org.viewOnly ? (
          <p className="rounded-3xl bg-white px-4 py-4 text-muted">
            The app is view-only until the payment is received.
          </p>
        ) : (
          <>
            <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl bg-brand px-6 text-center text-white active:bg-brand-dark">
              <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-brand-mid">
                <CameraIcon className="h-8 w-8" />
              </span>
              <span className="text-xl font-extrabold">Photo of trip sheet</span>
              <span className="text-sm text-brand-pale">Keep the sheet flat, in good light</span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void readPhoto(file);
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => setStep("form")}
              className="h-14 rounded-3xl bg-white text-base font-bold text-brand"
            >
              Type it in instead
            </button>
          </>
        )}
      </div>
    );
  }

  if (step === "reading") {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 py-10 text-center">
        {photo.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt="Trip sheet" className="max-h-72 rounded-3xl object-contain" />
        ) : null}
        <p className="text-lg font-extrabold">Reading the trip sheet…</p>
        <p className="text-sm text-muted">This takes a few seconds.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <BackLink href={tripsHref} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-2xl font-extrabold">
            {trip ? `Trip${trip.sheetNo ? ` #${trip.sheetNo}` : ""}` : "New trip"}
          </h1>
          {bus ? (
            <span className="text-sm text-muted">
              {bus.registrationNumber}
              {form.route ? ` · ${form.route}` : ""}
            </span>
          ) : null}
        </div>
        <StatusBadge approved={approved} />
      </div>

      {fromPhoto && !trip ? (
        <p className="rounded-3xl bg-brand-soft px-4 py-3 text-sm font-semibold text-brand-dark">
          Filled from the photo. Check every number against the sheet before you approve.
        </p>
      ) : null}
      {org.viewOnly ? (
        <p className="rounded-3xl bg-white px-4 py-3 text-sm text-muted">
          The app is view-only until the payment is received. This trip can be read but not changed.
        </p>
      ) : approved ? (
        <p className="rounded-3xl bg-white px-4 py-3 text-sm text-muted">
          {isAdmin
            ? "This trip is approved and counts in reports. As admin you can still correct it."
            : "This trip is approved and counts in reports. Only an admin can change it now."}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
        <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
          {photo.url ? (
            <a
              href={photo.url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-3xl bg-white p-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt="Trip sheet photo"
                className="max-h-56 w-full rounded-2xl object-contain lg:max-h-[60vh]"
              />
              <span className="block pt-2 text-center text-xs font-semibold text-brand">
                Tap to open full size
              </span>
            </a>
          ) : !locked ? (
            <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-3xl bg-white px-4 text-sm font-bold text-brand">
              <CameraIcon className="h-5 w-5" />
              Add the trip sheet photo
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  const image = await compressReceipt(file, { maxEdge: 2000, quality: 0.75 });
                  setPhoto({ url: URL.createObjectURL(image.blob), blob: image.blob, path: "" });
                }}
              />
            </label>
          ) : null}

          <ChecksCard checks={checks} />

          <section className="flex flex-col gap-3 rounded-3xl bg-brand p-5 text-white">
            <span className="text-[13px] font-semibold text-brand-pale">Advance settlement</span>
            <span className="text-[28px] font-extrabold leading-tight">
              {settlementText(totals.balanceInr)}
            </span>
            <div className="grid grid-cols-2 gap-2.5 text-sm">
              <Figure label="Advance given" value={formatInr(figures.advanceInr)} />
              <Figure label="Cash spent" value={formatInr(totals.cashSpentInr)} />
              <Figure
                label="Km run"
                value={totals.kmRun != null ? `${totals.kmRun.toLocaleString("en-IN")} km` : "–"}
              />
              <Figure
                label="Mileage"
                value={totals.mileage != null ? `${totals.mileage.toFixed(1)} km/L` : "–"}
              />
            </div>
          </section>
        </aside>

        <fieldset disabled={locked || saving} className={`flex min-w-0 flex-col gap-4 ${locked ? "opacity-80" : ""}`}>
          <Card title="Trip">
            <label className={LABEL}>
              Bus
              <select
                value={form.busId}
                onChange={(event) => set("busId", event.target.value)}
                className={FIELD}
              >
                {busOptions.length === 0 ? <option value="">No buses yet</option> : null}
                {busOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.registrationNumber}
                    {item.routeLabel ? ` · ${item.routeLabel}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
              <label className={LABEL}>
                Sheet no.
                <input value={form.sheetNo} onChange={(e) => set("sheetNo", e.target.value)} className={FIELD} />
              </label>
              <label className={LABEL}>
                Route
                <input
                  value={form.route}
                  onChange={(e) => set("route", e.target.value)}
                  placeholder="Chennai to Bengaluru"
                  className={FIELD}
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className={LABEL}>
                Start date
                <input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} className={FIELD} />
              </label>
              <label className={LABEL}>
                Start time
                <input type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} className={FIELD} />
              </label>
              <label className={LABEL}>
                End date
                <input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} className={FIELD} />
              </label>
              <label className={LABEL}>
                End time
                <input type="time" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} className={FIELD} />
              </label>
            </div>
            <label className={LABEL}>
              Halt dates (optional)
              <input value={form.haltNote} onChange={(e) => set("haltNote", e.target.value)} className={FIELD} />
            </label>
          </Card>

          <Card title="Crew">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={LABEL}>
                Driver 1
                <input value={form.driver1} onChange={(e) => set("driver1", e.target.value)} className={FIELD} />
              </label>
              <label className={LABEL}>
                Driver 2
                <input value={form.driver2} onChange={(e) => set("driver2", e.target.value)} className={FIELD} />
              </label>
              <label className={LABEL}>
                Cleaner
                <input value={form.cleaner} onChange={(e) => set("cleaner", e.target.value)} className={FIELD} />
              </label>
            </div>
          </Card>

          <Card title="Odometer">
            <div className="grid grid-cols-2 gap-3">
              <label className={LABEL}>
                Start km
                <input inputMode="numeric" value={form.startKm} onChange={(e) => set("startKm", e.target.value)} className={FIELD} />
              </label>
              <label className={LABEL}>
                End km
                <input inputMode="numeric" value={form.endKm} onChange={(e) => set("endKm", e.target.value)} className={FIELD} />
              </label>
            </div>
          </Card>

          <Card title="Diesel">
            {form.diesel.map((row, index) => (
              <div key={index} className="flex flex-col gap-2.5 border-t border-line pt-3 first:border-t-0 first:pt-0">
                <div className="grid grid-cols-2 gap-3">
                  <label className={LABEL}>
                    Litres
                    <input
                      inputMode="decimal"
                      value={row.litres}
                      onChange={(e) =>
                        set("diesel", form.diesel.map((item, i) => (i === index ? { ...item, litres: e.target.value } : item)))
                      }
                      className={FIELD}
                    />
                  </label>
                  <label className={LABEL}>
                    Amount (₹)
                    <input
                      inputMode="numeric"
                      value={row.amount}
                      onChange={(e) =>
                        set("diesel", form.diesel.map((item, i) => (i === index ? { ...item, amount: e.target.value } : item)))
                      }
                      className={FIELD}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="grid grid-cols-2 rounded-full bg-canvas p-1">
                    {(["cash", "credit"] as const).map((paidBy) => (
                      <button
                        key={paidBy}
                        type="button"
                        aria-pressed={row.paidBy === paidBy}
                        onClick={() =>
                          set("diesel", form.diesel.map((item, i) => (i === index ? { ...item, paidBy } : item)))
                        }
                        className={`h-10 min-h-10 rounded-full px-4 text-sm font-bold ${
                          row.paidBy === paidBy ? "bg-white text-ink shadow-[0_1px_3px_rgba(26,27,46,0.15)]" : "text-muted"
                        }`}
                      >
                        {paidBy === "cash" ? "Cash" : "Credit"}
                      </button>
                    ))}
                  </div>
                  <input
                    value={row.pump}
                    placeholder="Pump name"
                    aria-label={`Pump for diesel fill ${index + 1}`}
                    onChange={(e) =>
                      set("diesel", form.diesel.map((item, i) => (i === index ? { ...item, pump: e.target.value } : item)))
                    }
                    className={`${FIELD} flex-1 basis-40`}
                  />
                  <RemoveButton
                    label={`Remove diesel fill ${index + 1}`}
                    onClick={() => set("diesel", form.diesel.filter((_, i) => i !== index))}
                  />
                </div>
              </div>
            ))}
            <AddButton onClick={() => set("diesel", [...form.diesel, { ...EMPTY_DIESEL }])}>
              Add diesel fill
            </AddButton>
          </Card>

          <Card title="Cash expenses">
            {form.expenses.map((row, index) => (
              <div key={index} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] items-end gap-2">
                <label className={LABEL}>
                  <span className={index === 0 ? "" : "sr-only"}>For</span>
                  <select
                    value={row.category}
                    onChange={(e) =>
                      set(
                        "expenses",
                        form.expenses.map((item, i) =>
                          i === index ? { ...item, category: e.target.value as typeof row.category } : item,
                        ),
                      )
                    }
                    className={FIELD}
                  >
                    {TRIP_EXPENSE_CATEGORIES.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={LABEL}>
                  <span className={index === 0 ? "" : "sr-only"}>Amount (₹)</span>
                  <input
                    inputMode="numeric"
                    value={row.amount}
                    onChange={(e) =>
                      set("expenses", form.expenses.map((item, i) => (i === index ? { ...item, amount: e.target.value } : item)))
                    }
                    className={FIELD}
                  />
                </label>
                <RemoveButton
                  label={`Remove expense ${index + 1}`}
                  onClick={() => set("expenses", form.expenses.filter((_, i) => i !== index))}
                />
              </div>
            ))}
            <AddButton
              onClick={() => set("expenses", [...form.expenses, { category: "other", amount: "", note: "" }])}
            >
              Add expense
            </AddButton>
          </Card>

          <Card title="Advance">
            <div className="grid grid-cols-2 gap-3">
              <label className={LABEL}>
                Advance given (₹)
                <input inputMode="numeric" value={form.advance} onChange={(e) => set("advance", e.target.value)} className={FIELD} />
              </label>
              <label className={LABEL}>
                Total on the sheet (₹)
                <input
                  inputMode="numeric"
                  value={form.writtenTotal}
                  onChange={(e) => set("writtenTotal", e.target.value)}
                  placeholder="Optional"
                  className={FIELD}
                />
              </label>
            </div>
            <p className="text-xs text-muted">
              Credit diesel ({formatInr(totals.creditDieselInr)}) is paid to the pump later, so
              it is not taken from the advance.
            </p>
          </Card>
        </fieldset>
      </div>

      {error ? (
        <p role="alert" className="rounded-3xl bg-white px-4 py-3 text-sm font-semibold text-money-out">
          {error}
        </p>
      ) : null}

      {confirmApprove ? (
        <div className="flex flex-col gap-3 rounded-3xl bg-warn-bg p-4">
          <p className="font-bold text-warn-ink">
            {checks.length === 1 ? "1 thing needs" : `${checks.length} things need`} checking.
            Approve anyway?
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save(true)}
              className="h-12 rounded-2xl bg-brand px-5 font-bold text-white disabled:opacity-50"
            >
              Yes, approve
            </button>
            <button
              type="button"
              onClick={() => setConfirmApprove(false)}
              className="h-12 rounded-2xl bg-white px-5 font-bold text-ink"
            >
              Go back and check
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2.5">
        {!locked && !approved && !confirmApprove ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => void save(true)}
            className="h-14 flex-1 basis-48 rounded-2xl bg-brand px-5 text-base font-bold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Approve trip"}
          </button>
        ) : null}
        {!locked ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => void save(false)}
            className="h-14 flex-1 basis-40 rounded-2xl bg-white px-5 text-base font-bold text-brand disabled:opacity-50"
          >
            {approved ? (saving ? "Saving…" : "Save changes") : "Save for later"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={sendWhatsApp}
          className="h-14 flex-1 basis-40 rounded-2xl bg-white px-5 text-base font-bold text-money-in"
        >
          Send on WhatsApp
        </button>
      </div>
      {trip && !org.viewOnly && (!approved || isAdmin) ? (
        <button
          type="button"
          onClick={() => void remove()}
          className="self-start px-1 text-sm font-semibold text-muted"
        >
          Delete this trip
        </button>
      ) : null}
    </div>
  );
}

function BackLink({ href }: { href: string }) {
  return (
    <Link href={href} className="self-start text-sm font-bold text-brand">
      ‹ All trips
    </Link>
  );
}

export function StatusBadge({ approved }: { approved: boolean }) {
  return approved ? (
    <span className="inline-flex min-h-8 shrink-0 items-center whitespace-nowrap rounded-full bg-[#E3F2EA] px-3 text-xs font-bold text-money-in">
      Approved
    </span>
  ) : (
    <span className="inline-flex min-h-8 shrink-0 items-center whitespace-nowrap rounded-full bg-warn-bg px-3 text-xs font-bold text-warn-ink">
      To approve
    </span>
  );
}

function ChecksCard({ checks }: { checks: { id: string; message: string }[] }) {
  if (checks.length === 0) {
    return (
      <p className="rounded-3xl bg-white px-4 py-3 text-sm font-semibold text-money-in">
        Everything adds up.
      </p>
    );
  }
  return (
    <section className="flex flex-col gap-2 rounded-3xl bg-warn-bg p-4">
      <h2 className="flex items-center gap-2 font-extrabold text-warn-ink">
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#FFE2B3] px-1.5 text-xs">
          {checks.length}
        </span>
        Needs checking
      </h2>
      <ul className="flex flex-col gap-1.5 text-sm text-[#6B4A12]">
        {checks.map((check) => (
          <li key={check.id}>• {check.message}</li>
        ))}
      </ul>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-brand-mid px-3 py-2.5">
      <div className="text-xs text-brand-pale">{label}</div>
      <div className="font-bold">{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-white p-4 md:p-5">
      <h2 className="font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-pale text-sm font-bold text-brand"
    >
      + {children}
    </button>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg text-muted hover:bg-canvas"
    >
      ✕
    </button>
  );
}

function CameraIcon({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}
