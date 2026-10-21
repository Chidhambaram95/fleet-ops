"use client";

import { useMemo, useState } from "react";
import { deleteRow, listCrewPeople } from "@data/money/repository";
import { createSupabaseOperationsRepository } from "@data/operations/supabaseRepository";
import {
  addRenewal,
  documentPhotoUrl,
  listRenewals,
  uploadDocumentPhoto,
} from "@data/renewals/repository";
import type { ModuleId } from "@domain/modules/modules";
import { formatInr, todayInIst } from "@domain/operations/totals";
import {
  BUS_DOCUMENTS,
  DRIVER_DOCUMENTS,
  currentRenewals,
  daysLeft,
  dueStatus,
  dueText,
  isDriverDocument,
  reminderText,
  renewalLabel,
  type DueStatus,
} from "@domain/renewals/catalog";
import type { Renewal, RenewalKind } from "@domain/renewals/types";
import { useOrg } from "@/components/billing/OrgContext";
import { compressReceipt } from "@/lib/compressReceipt";
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
  Tabs,
  messageFromUnknown,
  shortDay,
  useLoaded,
  wholeNumber,
} from "@/components/ui/kit";

type Section = "buses" | "drivers" | "history";

const STATUS_CLASS: Record<DueStatus, string> = {
  expired: "bg-money-out text-white",
  due: "bg-warn-bg text-money-out",
  soon: "bg-warn-bg text-warn-ink",
  ok: "bg-brand-soft text-brand",
};

type Draft = {
  kind: RenewalKind;
  ownerId: string;
  permitType: string;
  expiresOn: string;
  amount: string;
  paidOn: string;
  note: string;
  photo: File | null;
};

function emptyDraft(kind: RenewalKind = "fc", ownerId = ""): Draft {
  return {
    kind,
    ownerId,
    permitType: "",
    expiresOn: "",
    amount: "",
    paidOn: todayInIst(),
    note: "",
    photo: null,
  };
}

export function RenewalsPage({ organizationId, module }: { organizationId: string; module: ModuleId }) {
  const org = useOrg();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const { data, loading, error, reload } = useLoaded(
    async () => {
      const [allRenewals, allBuses, allPeople] = await Promise.all([
        listRenewals(supabase, organizationId),
        createSupabaseOperationsRepository(supabase).listBuses(organizationId),
        listCrewPeople(supabase, organizationId),
      ]);
      // This module's buses and drivers, and their documents.
      const buses = allBuses.filter((bus) => bus.busType === module);
      const people = allPeople.filter((person) => person.module === module);
      const owners = new Set([...buses.map((bus) => bus.id), ...people.map((person) => person.id)]);
      const renewals = allRenewals.filter((renewal) => owners.has(renewal.busId ?? renewal.personId ?? ""));
      return { renewals, buses, people };
    },
    { renewals: [], buses: [], people: [] },
  );
  const today = todayInIst();
  const drivers = data.people.filter((person) => person.job === "driver" && person.active);
  const ownerName = (renewal: Pick<Renewal, "busId" | "personId">) =>
    renewal.busId
      ? (data.buses.find((bus) => bus.id === renewal.busId)?.registrationNumber ?? "Bus")
      : (data.people.find((person) => person.id === renewal.personId)?.name ?? "Driver");

  const current = useMemo(() => currentRenewals(data.renewals), [data.renewals]);
  const dueSoon = current
    .map((renewal) => ({ renewal, days: daysLeft(renewal.expiresOn, today) }))
    .filter((item) => item.days <= 30);
  const counts = {
    expired: dueSoon.filter((item) => item.days < 0).length,
    week: dueSoon.filter((item) => item.days >= 0 && item.days <= 7).length,
    month: dueSoon.filter((item) => item.days > 7).length,
  };

  const [section, setSection] = useState<Section>("buses");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  function openForm(kind: RenewalKind, ownerId: string) {
    setFormError("");
    setDraft(emptyDraft(kind, ownerId));
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function save() {
    if (!draft) return;
    if (!draft.ownerId) return setFormError(isDriverDocument(draft.kind) ? "Pick the driver." : "Pick the bus.");
    if (!draft.expiresOn) return setFormError("Enter the new expiry date.");
    const amount = draft.amount.trim() ? wholeNumber(draft.amount) : null;
    if (draft.amount.trim() && amount == null) return setFormError("Enter the amount in rupees.");
    setSaving(true);
    setFormError("");
    try {
      let photoPath = "";
      if (draft.photo) {
        const { blob } = await compressReceipt(draft.photo, { maxEdge: 1600, quality: 0.75 });
        photoPath = await uploadDocumentPhoto(supabase, organizationId, blob);
      }
      const driverDoc = isDriverDocument(draft.kind);
      await addRenewal(supabase, organizationId, {
        busId: driverDoc ? null : draft.ownerId,
        personId: driverDoc ? draft.ownerId : null,
        kind: draft.kind,
        permitType: draft.kind === "permit" ? draft.permitType : "",
        expiresOn: draft.expiresOn,
        amountInr: amount,
        paidOn: draft.paidOn || null,
        photoPath,
        note: draft.note,
      });
      setDraft(null);
      reload();
    } catch (saveError) {
      setFormError(messageFromUnknown(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function openPhoto(path: string) {
    try {
      const url = await documentPhotoUrl(supabase, path);
      if (url) window.open(url, "_blank", "noopener");
    } catch (photoError) {
      setFormError(messageFromUnknown(photoError));
    }
  }

  function sendReminder() {
    const text = reminderText(
      dueSoon.map(({ renewal, days }) => ({
        owner: ownerName(renewal),
        kind: renewal.kind,
        expiresOn: renewal.expiresOn,
        days,
      })),
    );
    // To the company's own WhatsApp number when it is set; otherwise WhatsApp asks who to send it to.
    window.open(`https://wa.me/${org.whatsappNumber}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  function documentRows(ownerId: string, documents: { id: RenewalKind; label: string }[]) {
    return documents.map((document, index) => {
      const found = current.find(
        (renewal) => renewal.kind === document.id && (renewal.busId ?? renewal.personId) === ownerId,
      );
      const days = found ? daysLeft(found.expiresOn, today) : null;
      return (
        <ListRow
          key={document.id}
          first={index === 0}
          title={`${document.label}${found?.permitType ? ` (${found.permitType})` : ""}`}
          detail={found ? `Valid till ${shortDay(found.expiresOn)}` : "Not added yet"}
          amount={
            days != null ? (
              <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs ${STATUS_CLASS[dueStatus(days)]}`}>
                {dueText(days)}
              </span>
            ) : undefined
          }
          actions={
            !org.viewOnly ? (
              <SmallButton tone="brand" onClick={() => openForm(document.id, ownerId)}>
                {found ? "Renew" : "Add"}
              </SmallButton>
            ) : null
          }
        />
      );
    });
  }

  const form = draft ? (
    <Card title={`${renewalLabel(draft.kind)} renewal`}>
      <label className={LABEL}>
        Document
        <select
          className={FIELD}
          value={draft.kind}
          onChange={(event) => {
            const kind = event.target.value as RenewalKind;
            const switched = isDriverDocument(kind) !== isDriverDocument(draft.kind);
            setDraft({ ...draft, kind, ownerId: switched ? "" : draft.ownerId });
          }}
        >
          <optgroup label="Bus">
            {BUS_DOCUMENTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Driver">
            {DRIVER_DOCUMENTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <label className={LABEL}>
        {isDriverDocument(draft.kind) ? "Driver" : "Bus"}
        <select className={FIELD} value={draft.ownerId} onChange={(event) => setDraft({ ...draft, ownerId: event.target.value })}>
          <option value="">Pick one</option>
          {isDriverDocument(draft.kind)
            ? drivers.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))
            : data.buses.map((bus) => (
                <option key={bus.id} value={bus.id}>
                  {bus.registrationNumber}
                </option>
              ))}
        </select>
      </label>
      {draft.kind === "permit" ? (
        <label className={LABEL}>
          Permit type
          <input
            className={FIELD}
            placeholder="e.g. All India tourist, Contract carriage"
            value={draft.permitType}
            onChange={(event) => setDraft({ ...draft, permitType: event.target.value })}
          />
        </label>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          New expiry date
          <input type="date" className={FIELD} value={draft.expiresOn} onChange={(event) => setDraft({ ...draft, expiresOn: event.target.value })} />
        </label>
        <label className={LABEL}>
          Amount paid ₹
          <input inputMode="numeric" className={FIELD} value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} />
        </label>
        <label className={LABEL}>
          Paid on
          <input type="date" className={FIELD} value={draft.paidOn} onChange={(event) => setDraft({ ...draft, paidOn: event.target.value })} />
        </label>
        <label className={LABEL}>
          Photo (optional)
          <input
            type="file"
            accept="image/*"
            className="h-12 w-full min-w-0 rounded-2xl bg-canvas px-3 py-3 text-sm"
            onChange={(event) => setDraft({ ...draft, photo: event.target.files?.[0] ?? null })}
          />
        </label>
      </div>
      <label className={LABEL}>
        Note (optional)
        <input className={FIELD} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
      </label>
      <ErrorText message={formError} />
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className={SECONDARY} onClick={() => setDraft(null)}>
          Cancel
        </button>
        <button type="button" className={PRIMARY} disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Card>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Documents due"
        hint="FC, insurance, permit, tax and driver licences in one place."
        action={
          !org.viewOnly ? (
            <button type="button" className={PRIMARY} onClick={() => openForm("fc", "")}>
              + Add renewal
            </button>
          ) : null
        }
      />
      <ErrorText message={error} />

      <section className="flex flex-col gap-3 rounded-3xl bg-brand p-4 text-white md:p-5">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-2xl font-extrabold">{counts.expired}</p>
            <p className="text-xs text-brand-pale">Expired</p>
          </div>
          <div>
            <p className="text-2xl font-extrabold">{counts.week}</p>
            <p className="text-xs text-brand-pale">In 7 days</p>
          </div>
          <div>
            <p className="text-2xl font-extrabold">{counts.month}</p>
            <p className="text-xs text-brand-pale">In 30 days</p>
          </div>
        </div>
        {dueSoon.length ? (
          <button
            type="button"
            onClick={sendReminder}
            className="h-12 rounded-2xl bg-white text-[15px] font-bold text-brand"
          >
            Send reminder on WhatsApp
          </button>
        ) : (
          <p className="text-center text-sm text-brand-pale">Nothing due in the next 30 days.</p>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-[1fr_380px] md:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {draft ? <div className="md:hidden">{form}</div> : null}
          <Tabs<Section>
            value={section}
            onChange={setSection}
            options={[
              { id: "buses", label: "Bus documents" },
              { id: "drivers", label: "Driver licences" },
              { id: "history", label: "Past renewals" },
            ]}
          />
          {loading ? <p className="text-muted">Loading…</p> : null}
          {section === "buses"
            ? data.buses.length === 0 && !loading
              ? <p className="text-muted">Add buses on the Buses page first.</p>
              : data.buses.map((bus) => (
                  <Card key={bus.id} title={bus.registrationNumber}>
                    <div>{documentRows(bus.id, BUS_DOCUMENTS)}</div>
                  </Card>
                ))
            : null}
          {section === "drivers"
            ? drivers.length === 0 && !loading
              ? <p className="text-muted">Add drivers on the Crew page first.</p>
              : drivers.map((person) => (
                  <Card key={person.id} title={person.name}>
                    <div>{documentRows(person.id, DRIVER_DOCUMENTS)}</div>
                  </Card>
                ))
            : null}
          {section === "history" ? (
            <Card title="Every renewal">
              {data.renewals.length === 0 ? (
                <p className="text-muted">No renewals entered yet.</p>
              ) : (
                data.renewals.map((renewal, index) => (
                  <ListRow
                    key={renewal.id}
                    first={index === 0}
                    title={`${ownerName(renewal)} · ${renewalLabel(renewal.kind)}`}
                    detail={[
                      `Till ${shortDay(renewal.expiresOn)}`,
                      renewal.paidOn ? `paid ${shortDay(renewal.paidOn)}` : "",
                      renewal.note,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    amount={renewal.amountInr != null ? formatInr(renewal.amountInr) : undefined}
                    actions={
                      <>
                        {renewal.photoPath ? (
                          <SmallButton tone="brand" onClick={() => openPhoto(renewal.photoPath)}>
                            Photo
                          </SmallButton>
                        ) : null}
                        {!org.viewOnly ? (
                          <SmallButton
                            onClick={async () => {
                              if (!window.confirm("Delete this renewal record? This cannot be undone.")) return;
                              try {
                                await deleteRow(supabase, "renewals", organizationId, renewal.id);
                                reload();
                              } catch (removeError) {
                                setFormError(messageFromUnknown(removeError));
                              }
                            }}
                          >
                            Delete
                          </SmallButton>
                        ) : null}
                      </>
                    }
                  />
                ))
              )}
            </Card>
          ) : null}
        </div>
        <aside className="hidden md:sticky md:top-24 md:flex md:flex-col md:gap-4">
          {form ?? (
            <Card title="Reminders">
              <p className="text-sm text-muted">
                Anything due in 30 days shows on the home screen. Tap “Send reminder on WhatsApp” to
                share the list with your team.
              </p>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
