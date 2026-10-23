"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  addPersonDirectAction,
  deleteCompanyAction,
  inviteAdminAction,
  removeMemberAction,
  setCompanyActiveAction,
  setPersonPasswordAction,
  setMemberRoleAction,
  updateCompanyAction,
} from "@/app/(admin)/admin/actions";
import { InviteShare } from "@/components/admin/InviteShare";
import { loginLabel, MIN_PASSWORD_LENGTH } from "@domain/auth/loginId";
import {
  BUS_TYPES,
  BUS_TYPE_LABELS,
  type BusType,
  type Company,
  type CompanyMember,
  type PendingInvite,
} from "@domain/companies/types";

const input =
  "h-12 w-full min-w-0 rounded-2xl border border-[#DCDDF7] bg-[#F3F4FB] px-3.5 text-base font-normal";
const label = "flex min-w-0 flex-col gap-1.5 text-[13px] font-semibold";
const card = "flex flex-col gap-4 rounded-3xl bg-white p-5";
const primary =
  "h-12 rounded-2xl bg-[#3A3FB8] px-5 text-[15px] font-bold text-white disabled:opacity-50";

const ROLE_LABELS: Record<string, string> = {
  owner: "Admin",
  admin: "Admin",
  manager: "Manager",
  fleet_manager: "Manager",
  member: "Manager",
  crew: "Crew",
};

type Result = { error?: string };

export function CompanyEditForm({ company }: { company: Company }) {
  const router = useRouter();
  const [name, setName] = useState(company.name);
  const [town, setTown] = useState(company.town);
  const [gstin, setGstin] = useState(company.gstin);
  const [whatsapp, setWhatsapp] = useState(company.whatsappNumber);
  const [busTypes, setBusTypes] = useState<BusType[]>(company.busTypes);
  const [maxBuses, setMaxBuses] = useState(company.maxBuses == null ? "" : String(company.maxBuses));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setBusy(true);
    setMessage("");
    const result: Result = await updateCompanyAction(company.organizationId, {
      name,
      town,
      gstin,
      whatsappNumber: whatsapp,
      busTypes,
      maxBuses,
    });
    setBusy(false);
    setMessage(result.error ?? "Saved.");
    if (!result.error) {
      // Show what was saved, the same way the server cleans it up.
      setName(name.trim());
      setTown(town.trim());
      setGstin(gstin.trim().toUpperCase());
      setWhatsapp(whatsapp.trim());
      setMaxBuses(maxBuses.trim());
      router.refresh();
    }
  }

  return (
    <section className={card}>
      <h2 className="text-lg font-extrabold">Company details</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Company name
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={label}>
          Town
          <input className={input} value={town} onChange={(e) => setTown(e.target.value)} />
        </label>
        <label className={label}>
          GSTIN
          <input className={input} value={gstin} onChange={(e) => setGstin(e.target.value)} />
        </label>
        <label className={label}>
          Company WhatsApp
          <input inputMode="tel" className={input} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
        </label>
        <label className={label}>
          Most buses they can add
          <input
            inputMode="numeric"
            className={input}
            placeholder="No limit"
            value={maxBuses}
            onChange={(e) => setMaxBuses(e.target.value)}
          />
          <span className="text-xs font-normal text-[#5B5E7A]">
            They have {company.busCount} now. Leave empty for no limit.
          </span>
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[13px] font-semibold">Bus types allowed</legend>
          <div className="flex flex-wrap gap-2">
            {BUS_TYPES.map((type) => {
              const on = busTypes.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setBusTypes((list) => (on ? list.filter((item) => item !== type) : [...list, type]))
                  }
                  className={`h-11 rounded-full px-4 text-sm font-bold ${
                    on ? "bg-[#3A3FB8] text-white" : "bg-[#F3F4FB] text-[#5B5E7A]"
                  }`}
                >
                  {BUS_TYPE_LABELS[type]}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primary} disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save details"}
        </button>
        {message ? (
          <p role="status" className={`text-sm font-semibold ${message === "Saved." ? "text-[#1E6B45]" : "text-[#A3321C]"}`}>
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function CompanyPeople({
  company,
  members,
  invites,
}: {
  company: Company;
  members: CompanyMember[];
  invites: PendingInvite[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteWhatsapp, setInviteWhatsapp] = useState("");
  const [inviteRole, setInviteRole] = useState("admin");
  const [created, setCreated] = useState<{ token: string; name: string; whatsapp: string } | null>(null);
  const [addMode, setAddMode] = useState<"password" | "invite">("password");
  const [loginId, setLoginId] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [added, setAdded] = useState("");
  const [passwordFor, setPasswordFor] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [passwordSaved, setPasswordSaved] = useState("");

  async function run(key: string, action: () => Promise<Result>) {
    setBusy(key);
    setError("");
    const result = await action();
    setBusy("");
    if (result.error) {
      setError(result.error);
      return false;
    }
    router.refresh();
    return true;
  }

  async function addDirect() {
    setBusy("invite");
    setError("");
    setAdded("");
    const result: Result & { login?: string } = await addPersonDirectAction(company.organizationId, {
      name: inviteName,
      loginId,
      password: newPassword,
      role: inviteRole,
    });
    setBusy("");
    if (result.error) {
      setError(result.error);
      return;
    }
    setAdded(`${inviteName.trim()} can now sign in with ${result.login} and the password you set.`);
    setInviteName("");
    setLoginId("");
    setNewPassword("");
    router.refresh();
  }

  async function savePassword(userId: string) {
    setPasswordSaved("");
    const done = await run(userId, () => setPersonPasswordAction(company.organizationId, userId, memberPassword));
    if (done) {
      setPasswordFor("");
      setMemberPassword("");
      setPasswordSaved("New password saved. Tell them in person or on WhatsApp.");
    }
  }

  async function invite() {
    setBusy("invite");
    setError("");
    const result: Result & { token?: string } = await inviteAdminAction(company.organizationId, {
      name: inviteName,
      whatsapp: inviteWhatsapp,
      role: inviteRole,
    });
    setBusy("");
    if (result.error || !result.token) {
      setError(result.error ?? "Could not create the invite.");
      return;
    }
    setCreated({ token: result.token, name: inviteName.trim(), whatsapp: inviteWhatsapp });
    setInviteName("");
    setInviteWhatsapp("");
    router.refresh();
  }

  return (
    <section className={card}>
      <h2 className="text-lg font-extrabold">People and access</h2>
      {members.length === 0 ? (
        <p className="text-sm text-[#5B5E7A]">No one has joined yet.</p>
      ) : (
        <ul className="flex flex-col">
          {members.map((member, index) => (
            <li
              key={member.userId}
              className={`flex flex-wrap items-center justify-between gap-3 py-3 ${index ? "border-t border-[#EEEFF7]" : ""}`}
            >
              <div className="min-w-0">
                <p className="truncate font-bold">{member.displayName || loginLabel(member.email) || "Unnamed"}</p>
                {member.displayName && member.email ? (
                  <p className="truncate text-xs text-[#5B5E7A]">{loginLabel(member.email)}</p>
                ) : null}
                {passwordFor === member.userId ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      aria-label={`New password for ${member.displayName || "this person"}`}
                      className={`${input} h-11 w-44`}
                      value={memberPassword}
                      minLength={MIN_PASSWORD_LENGTH}
                      onChange={(e) => setMemberPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="h-11 rounded-2xl bg-[#3A3FB8] px-3 text-sm font-bold text-white"
                      disabled={busy !== ""}
                      onClick={() => void savePassword(member.userId)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="h-11 px-2 text-sm font-semibold text-[#5B5E7A]"
                      onClick={() => setPasswordFor("")}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="mt-1 text-xs font-semibold text-[#3A3FB8]"
                    onClick={() => {
                      setPasswordFor(member.userId);
                      setMemberPassword("");
                      setPasswordSaved("");
                    }}
                  >
                    Set new password
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label={`Access for ${member.displayName || member.email}`}
                  className="h-11 rounded-2xl bg-[#F3F4FB] px-3 text-sm font-semibold"
                  value={ROLE_LABELS[member.role] === "Admin" ? "admin" : ROLE_LABELS[member.role] === "Manager" ? "manager" : "crew"}
                  disabled={busy !== ""}
                  onChange={(e) =>
                    void run(member.userId, () =>
                      setMemberRoleAction(company.organizationId, member.userId, e.target.value),
                    )
                  }
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="crew">Crew</option>
                </select>
                {confirmRemove === member.userId ? (
                  <>
                    <button
                      type="button"
                      className="h-11 rounded-2xl bg-[#A3321C] px-3 text-sm font-bold text-white"
                      disabled={busy !== ""}
                      onClick={() =>
                        void run(member.userId, () => removeMemberAction(company.organizationId, member.userId)).then(
                          () => setConfirmRemove(""),
                        )
                      }
                    >
                      Remove
                    </button>
                    <button type="button" className="h-11 px-2 text-sm font-semibold text-[#5B5E7A]" onClick={() => setConfirmRemove("")}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="h-11 px-2 text-sm font-semibold text-[#5B5E7A]"
                    onClick={() => setConfirmRemove(member.userId)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {invites.length ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-[#F3F4FB] p-3">
          <p className="text-xs font-semibold text-[#5B5E7A]">Invited, not joined yet</p>
          {invites.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                {item.displayName || "Unnamed"} · {ROLE_LABELS[item.role] ?? item.role}
              </span>
              <InviteShare token={item.token} company={company.name} name={item.displayName} whatsappNumber={item.whatsappNumber} />
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-[#EEEFF7] pt-4">
        <h3 className="font-extrabold">Add an admin or manager</h3>
        <div className="flex gap-1 self-start rounded-full bg-[#F3F4FB] p-1" role="group" aria-label="How to add">
          {(["password", "invite"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={addMode === mode}
              className={`h-9 rounded-full px-4 text-sm font-bold ${addMode === mode ? "bg-white text-[#3A3FB8]" : "text-[#5B5E7A]"}`}
              onClick={() => setAddMode(mode)}
            >
              {mode === "password" ? "With a password" : "WhatsApp invite"}
            </button>
          ))}
        </div>
        {added ? (
          <p role="status" className="rounded-2xl bg-[#E6E7FA] p-3 text-sm font-semibold">
            {added}
          </p>
        ) : null}
        {created ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-[#E6E7FA] p-3">
            <p className="text-sm font-semibold">Invite ready for {created.name || "them"}. Send it now:</p>
            <InviteShare token={created.token} company={company.name} name={created.name} whatsappNumber={created.whatsapp} />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            Name
            <input className={input} value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
          </label>
          {addMode === "invite" ? (
            <label className={label}>
              WhatsApp number
              <input inputMode="tel" className={input} value={inviteWhatsapp} onChange={(e) => setInviteWhatsapp(e.target.value)} />
            </label>
          ) : (
            <>
              <label className={label}>
                Email or phone number
                <input inputMode="email" className={input} value={loginId} onChange={(e) => setLoginId(e.target.value)} />
              </label>
              <label className={label}>
                Password
                <input
                  type="text"
                  className={input}
                  value={newPassword}
                  minLength={MIN_PASSWORD_LENGTH}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
            </>
          )}
          <label className={label}>
            Access
            <select className={input} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
            </select>
          </label>
        </div>
        {addMode === "invite" ? (
          <button type="button" className={`${primary} self-start`} disabled={busy !== ""} onClick={invite}>
            {busy === "invite" ? "Creating…" : "Create invite"}
          </button>
        ) : (
          <button type="button" className={`${primary} self-start`} disabled={busy !== ""} onClick={addDirect}>
            {busy === "invite" ? "Adding…" : "Add person"}
          </button>
        )}
      </div>
      {passwordSaved ? (
        <p role="status" className="text-sm font-semibold text-[#3A3FB8]">
          {passwordSaved}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-semibold text-[#A3321C]">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function CompanyDanger({
  company,
  deletableOn,
  canDeleteNow,
}: {
  company: Company;
  /** Shown as "Delete from …"; empty while active. */
  deletableOn: string;
  canDeleteNow: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"" | "deactivate" | "delete">("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<Result>, after: () => void) {
    setBusy(true);
    setError("");
    const result = await action();
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    after();
  }

  const active = !company.deactivatedAt;
  return (
    <section className={`${card} border-2 border-[#FDECEA]`}>
      <h2 className="text-lg font-extrabold">{active ? "Deactivate company" : "Company is deactivated"}</h2>
      {active ? (
        <>
          <p className="text-sm text-[#5B5E7A]">
            Everyone in {company.name} loses access straight away. Their data is kept and nothing is deleted.
            You can reactivate at any time. Deleting the data is only possible 30 days after deactivating, and
            only when you press Delete.
          </p>
          {step === "deactivate" ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy}
                className="h-12 rounded-2xl bg-[#A3321C] px-5 text-[15px] font-bold text-white disabled:opacity-50"
                onClick={() =>
                  run(() => setCompanyActiveAction(company.organizationId, false), () => {
                    setStep("");
                    router.refresh();
                  })
                }
              >
                {busy ? "Deactivating…" : `Yes, deactivate ${company.name}`}
              </button>
              <button type="button" className="h-12 px-3 font-semibold text-[#5B5E7A]" onClick={() => setStep("")}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="h-12 self-start rounded-2xl bg-[#FDECEA] px-5 text-[15px] font-bold text-[#A3321C]"
              onClick={() => setStep("deactivate")}
            >
              Deactivate
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-[#5B5E7A]">
            No one in this company can sign in. All their data is kept until you delete it.{" "}
            {canDeleteNow ? "Delete is now available." : `Delete becomes available on ${deletableOn}.`}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              className={primary}
              onClick={() => run(() => setCompanyActiveAction(company.organizationId, true), () => router.refresh())}
            >
              Reactivate
            </button>
            <button
              type="button"
              disabled={!canDeleteNow || busy}
              title={canDeleteNow ? undefined : `Available on ${deletableOn}`}
              className="h-12 rounded-2xl bg-[#FDECEA] px-5 text-[15px] font-bold text-[#A3321C] disabled:opacity-50"
              onClick={() => setStep("delete")}
            >
              {canDeleteNow ? "Delete all data" : `Delete (from ${deletableOn})`}
            </button>
          </div>
          {step === "delete" && canDeleteNow ? (
            <div className="flex flex-col gap-3 rounded-2xl bg-[#FDECEA] p-4">
              <p className="text-sm font-semibold text-[#A3321C]">
                This deletes every bus, entry, trip sheet, photo, cost, salary, renewal and payment record of{" "}
                {company.name}. It cannot be undone. Download any reports you need first.
              </p>
              <label className={label}>
                Type the company name to confirm
                <input className={input} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={company.name} />
              </label>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy || typed.trim() !== company.name.trim()}
                  className="h-12 rounded-2xl bg-[#A3321C] px-5 text-[15px] font-bold text-white disabled:opacity-50"
                  onClick={() =>
                    run(() => deleteCompanyAction(company.organizationId, typed), () => router.replace("/admin/companies"))
                  }
                >
                  {busy ? "Deleting…" : "Delete for good"}
                </button>
                <button type="button" className="h-12 px-3 font-semibold text-[#5B5E7A]" onClick={() => setStep("")}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm font-semibold text-[#A3321C]">
          {error}
        </p>
      ) : null}
    </section>
  );
}
