"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  addMemberDirectAction,
  assignCrewToBusAction,
  cancelInviteAction,
  createInviteAction,
  removeMemberAction,
  setMemberPasswordAction,
  updateMemberModuleAction,
  updateMemberRoleAction,
} from "@/app/(app)/settings/team/actions";
import { InviteShare } from "@/components/admin/InviteShare";
import { useOrg } from "@/components/billing/OrgContext";
import type { PendingInvite } from "@domain/companies/types";
import { MODULE_LABELS, type ModuleId } from "@domain/modules/modules";
import type { Bus } from "@domain/operations/types";
import {
  ROLE_LABELS,
  USER_ROLES,
  type OrganizationMember,
  type UserRole,
} from "@domain/rbac/roles";

export function TeamSettings({
  role: myRole,
  logins = {},
  members,
  buses,
  invites,
  companyName,
  currentUserId,
  modules = [],
}: {
  /** Admins manage everything; managers can only remove crew. */
  role: UserRole;
  /** Each member's login, as shown on screen. */
  logins?: Record<string, string>;
  members: OrganizationMember[];
  buses: Bus[];
  invites: PendingInvite[];
  companyName: string;
  currentUserId: string;
  /** The company's switched-on modules. A manager can be limited to one. */
  modules?: ModuleId[];
}) {
  const router = useRouter();
  const { viewOnly } = useOrg();
  const [roles, setRoles] = useState<Record<string, UserRole>>(() =>
    Object.fromEntries(members.map((member) => [member.userId, member.role])),
  );
  const [busIds, setBusIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      members.map((member) => [member.userId, member.busId ?? ""]),
    ),
  );
  const [memberModules, setMemberModules] = useState<Record<string, string>>(() =>
    Object.fromEntries(members.map((member) => [member.userId, member.module ?? ""])),
  );
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [fresh, setFresh] = useState<{ token: string; name: string; whatsapp: string } | null>(null);
  const [newRole, setNewRole] = useState<UserRole>("crew");
  const [newBusId, setNewBusId] = useState("");
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<"direct" | "invite">("direct");
  const [loginId, setLoginId] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [added, setAdded] = useState<{ name: string; login: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState("");
  const [passwordFor, setPasswordFor] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [notice, setNotice] = useState("");
  const isAdmin = myRole === "admin";

  const memberKey = members.map((member) => member.userId).join(",");

  useEffect(() => {
    setRoles(
      Object.fromEntries(members.map((member) => [member.userId, member.role])),
    );
    setBusIds(
      Object.fromEntries(
        members.map((member) => [member.userId, member.busId ?? ""]),
      ),
    );
    setMemberModules(
      Object.fromEntries(members.map((member) => [member.userId, member.module ?? ""])),
    );
  }, [memberKey, members]);

  async function onModuleChange(userId: string, module: string) {
    const previous = memberModules[userId] ?? "";
    setMemberModules((current) => ({ ...current, [userId]: module }));
    setPendingId(userId);
    setError("");
    const result = await updateMemberModuleAction(userId, module);
    setPendingId("");
    if (result.error) {
      setError(result.error);
      setMemberModules((current) => ({ ...current, [userId]: previous }));
      return;
    }
    router.refresh();
  }

  async function saveRole(
    userId: string,
    role: UserRole,
    previousRole: UserRole,
    previousBusId: string,
    busId?: string,
  ) {
    setPendingId(userId);
    setError("");
    const result =
      role === "crew"
        ? await assignCrewToBusAction(userId, busId ?? "")
        : await updateMemberRoleAction(userId, role);
    setPendingId("");
    if (result.error) {
      setRoles((current) => ({ ...current, [userId]: previousRole }));
      setBusIds((current) => ({ ...current, [userId]: previousBusId }));
      setError(result.error);
      return;
    }
    router.refresh();
  }

  function onRoleChange(member: OrganizationMember, role: UserRole) {
    const previousRole = roles[member.userId] ?? member.role;
    const previousBusId = busIds[member.userId] ?? member.busId ?? "";
    setRoles((current) => ({ ...current, [member.userId]: role }));
    if (role === "crew") {
      const busId = previousBusId;
      if (busId) {
        void saveRole(member.userId, "crew", previousRole, previousBusId, busId);
      }
      return;
    }
    void saveRole(member.userId, role, previousRole, previousBusId);
  }

  function onBusChange(userId: string, busId: string) {
    const member = members.find((item) => item.userId === userId);
    const previousRole = roles[userId] ?? member?.role ?? "crew";
    const previousBusId = busIds[userId] ?? member?.busId ?? "";
    setBusIds((current) => ({ ...current, [userId]: busId }));
    if (busId) {
      void saveRole(userId, "crew", previousRole, previousBusId, busId);
    }
  }

  async function addDirect() {
    setAdding(true);
    setError("");
    setNotice("");
    const name = displayName.trim();
    const result = await addMemberDirectAction({
      displayName,
      loginId,
      password: newPassword,
      role: newRole,
      busId: newBusId,
    });
    setAdding(false);
    if (result.error || !result.login) {
      setError(result.error ?? "Could not add this person.");
      return;
    }
    setAdded({ name, login: result.login });
    setFresh(null);
    setDisplayName("");
    setLoginId("");
    setNewPassword("");
    setNewRole("crew");
    setNewBusId("");
    router.refresh();
  }

  async function removeMember(userId: string) {
    setPendingId(userId);
    setError("");
    setNotice("");
    const result = await removeMemberAction(userId);
    setPendingId("");
    setConfirmRemove("");
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function savePassword(userId: string, name: string) {
    setPendingId(userId);
    setError("");
    setNotice("");
    const result = await setMemberPasswordAction(userId, passwordValue);
    setPendingId("");
    if (result.error) {
      setError(result.error);
      return;
    }
    setPasswordFor("");
    setPasswordValue("");
    setNotice(`New password saved for ${name}. Tell them the new password.`);
  }

  async function addMember() {
    setAdding(true);
    setError("");
    setAdded(null);
    const result = await createInviteAction({
      displayName,
      whatsappNumber: whatsapp,
      role: newRole,
      busId: newBusId,
    });
    setAdding(false);
    if (result.error || !result.token) {
      setError(result.error ?? "Could not create the invite.");
      return;
    }
    setFresh({ token: result.token, name: displayName.trim(), whatsapp });
    setDisplayName("");
    setWhatsapp("");
    setNewRole("crew");
    setNewBusId("");
    router.refresh();
  }

  async function cancel(inviteId: string) {
    setError("");
    const result = await cancelInviteAction(inviteId);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-extrabold">Team & logins</h1>
        <p className="text-sm text-muted">
          {isAdmin
            ? "Add a person with their email or mobile number and a password, or invite them on WhatsApp. Crew members need one bus."
            : "Everyone in your company. You can remove crew who have left."}
        </p>
      </div>

      {error ? <p role="alert" className="text-sm text-money-out">{error}</p> : null}
      {notice ? <p className="rounded-2xl bg-brand-soft px-4 py-3 text-sm font-semibold">{notice}</p> : null}

      {!isAdmin ? null : viewOnly ? (
        <p className="rounded-3xl bg-white px-4 py-4 text-sm text-muted">
          The app is view-only until the payment is received. Invites and role changes open again after that.
        </p>
      ) : (
      <form
        className="flex flex-col gap-2 rounded-3xl bg-white p-4 md:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void (addMode === "direct" ? addDirect() : addMember());
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Add someone</p>
          <div role="group" aria-label="How to add" className="flex rounded-2xl bg-canvas p-1 text-sm font-semibold">
            {(["direct", "invite"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={addMode === mode}
                onClick={() => {
                  setAddMode(mode);
                  setError("");
                }}
                className={`rounded-xl px-3 py-1.5 ${addMode === mode ? "bg-white text-brand" : "text-muted"}`}
              >
                {mode === "direct" ? "With a password" : "WhatsApp invite"}
              </button>
            ))}
          </div>
        </div>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Name"
          aria-label="Name"
          autoComplete="off"
          className="h-12 rounded-2xl bg-canvas px-4 text-base font-normal"
        />
        {addMode === "direct" ? (
          <>
            <input
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              placeholder="Email or mobile number (their login)"
              aria-label="Email or mobile number"
              autoComplete="off"
              autoCapitalize="none"
              className="h-12 rounded-2xl bg-canvas px-4 text-base font-normal"
            />
            <input
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="Password (at least 6 characters)"
              aria-label="Password for this person"
              type="text"
              autoComplete="new-password"
              className="h-12 rounded-2xl bg-canvas px-4 text-base font-normal"
            />
          </>
        ) : (
          <input
            value={whatsapp}
            onChange={(event) => setWhatsapp(event.target.value)}
            placeholder="WhatsApp number"
            aria-label="WhatsApp number"
            inputMode="tel"
            autoComplete="off"
            className="h-12 rounded-2xl bg-canvas px-4 text-base font-normal"
          />
        )}
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Role
          <select
            value={newRole}
            onChange={(event) => setNewRole(event.target.value as UserRole)}
            className="h-11 rounded-2xl bg-canvas px-3 text-sm"
          >
            {USER_ROLES.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        {newRole === "crew" ? (
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            Bus
            <select
              value={newBusId}
              onChange={(event) => setNewBusId(event.target.value)}
              className="h-11 rounded-2xl bg-canvas px-3 text-sm"
            >
              <option value="">
                {buses.length === 0 ? "No buses yet" : "Pick their bus"}
              </option>
              {buses.map((bus) => (
                <option key={bus.id} value={bus.id}>
                  {bus.registrationNumber}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="submit"
          disabled={adding}
          className="h-12 rounded-2xl bg-brand px-4 text-[15px] font-bold text-white disabled:opacity-60"
        >
          {adding ? "Saving…" : addMode === "direct" ? "Add person" : "Create invite"}
        </button>
      </form>
      )}

      {added ? (
        <section className="flex flex-col gap-1 rounded-3xl bg-brand-soft p-4 text-sm">
          <p className="font-semibold">{added.name || "They"} can sign in now.</p>
          <p>
            Login: <span className="font-semibold">{added.login}</span> · Password: the one you typed. Tell them both;
            only an admin can see or change this password.
          </p>
        </section>
      ) : null}

      {fresh ? (
        <section className="flex flex-col gap-2 rounded-3xl bg-brand-soft p-3">
          <p className="text-sm font-semibold">Invite ready for {fresh.name}</p>
          <InviteShare
            token={fresh.token}
            company={companyName}
            name={fresh.name}
            whatsappNumber={fresh.whatsapp}
          />
        </section>
      ) : null}

      {invites.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-3xl bg-white p-4 md:p-5">
          <p className="text-sm font-semibold">Waiting to join</p>
          {invites.map((invite) => (
            <div key={invite.id} className="flex flex-col gap-2 border-t border-line pt-2">
              <p className="text-sm">
                <span className="font-medium">{invite.displayName || "Invited person"}</span>{" "}
                <span className="text-muted">· {ROLE_LABELS[invite.role as UserRole] ?? invite.role}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <InviteShare
                  token={invite.token}
                  company={companyName}
                  name={invite.displayName}
                  whatsappNumber={invite.whatsappNumber}
                />
                {viewOnly ? null : (
                <button
                  type="button"
                  onClick={() => void cancel(invite.id)}
                  className="rounded-xl px-3 text-sm font-medium text-muted"
                >
                  Cancel invite
                </button>
                )}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <div className="overflow-x-auto rounded-3xl bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-3 font-semibold">Member</th>
              <th className="px-3 py-3 font-semibold">Role</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const role = roles[member.userId] ?? member.role;
              const isSelf = member.userId === currentUserId;
              const pending = pendingId === member.userId;
              return (
                <tr key={member.userId} className="border-b border-line align-top">
                  <td className="px-3 py-3">
                    <p className="font-medium">{member.displayName}</p>
                    {logins[member.userId] ? (
                      <p className="break-all text-xs text-muted">{logins[member.userId]}</p>
                    ) : null}
                    {isSelf ? (
                      <p className="text-xs text-muted">You</p>
                    ) : null}
                    {!isSelf && member.role !== "admin" && (isAdmin || member.role === "crew") ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {isAdmin && passwordFor !== member.userId ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              setPasswordFor(member.userId);
                              setPasswordValue("");
                              setConfirmRemove("");
                            }}
                            className="rounded-xl bg-canvas px-3 py-2 text-xs font-semibold"
                          >
                            Set new password
                          </button>
                        ) : null}
                        {confirmRemove === member.userId ? (
                          <>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => void removeMember(member.userId)}
                              className="rounded-xl bg-money-out px-3 py-2 text-xs font-bold text-white"
                            >
                              {pending ? "Removing…" : `Remove ${member.displayName}`}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmRemove("")}
                              className="rounded-xl px-2 py-2 text-xs font-semibold text-muted"
                            >
                              Keep
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              setConfirmRemove(member.userId);
                              setPasswordFor("");
                            }}
                            className="rounded-xl px-3 py-2 text-xs font-semibold text-money-out"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ) : null}
                    {confirmRemove === member.userId ? (
                      <p className="mt-1 text-xs text-muted">
                        They lose access at once. Their past entries stay.
                      </p>
                    ) : null}
                    {passwordFor === member.userId ? (
                      <form
                        className="mt-2 flex flex-wrap items-center gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void savePassword(member.userId, member.displayName);
                        }}
                      >
                        <input
                          value={passwordValue}
                          onChange={(event) => setPasswordValue(event.target.value)}
                          placeholder="New password"
                          aria-label={`New password for ${member.displayName}`}
                          autoComplete="new-password"
                          className="h-10 min-w-0 flex-1 rounded-xl bg-canvas px-3 text-sm"
                        />
                        <button
                          type="submit"
                          disabled={pending}
                          className="h-10 rounded-xl bg-brand px-3 text-xs font-bold text-white disabled:opacity-60"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setPasswordFor("")}
                          className="h-10 px-2 text-xs font-semibold text-muted"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <label className="flex flex-col gap-2">
                      <span className="sr-only">Role for {member.displayName}</span>
                      <select
                        value={role}
                        disabled={isSelf || pending || viewOnly || !isAdmin}
                        onChange={(event) =>
                          onRoleChange(member, event.target.value as UserRole)
                        }
                        className="h-11 rounded-2xl bg-canvas px-3 text-sm disabled:opacity-60"
                      >
                        {USER_ROLES.map((option) => (
                          <option key={option} value={option}>
                            {ROLE_LABELS[option]}
                          </option>
                        ))}
                      </select>
                      {role === "crew" ? (
                        <select
                          value={busIds[member.userId] ?? ""}
                          disabled={isSelf || pending || viewOnly || !isAdmin || buses.length === 0}
                          onChange={(event) =>
                            onBusChange(member.userId, event.target.value)
                          }
                          aria-label={`Bus for ${member.displayName}`}
                          className="h-11 rounded-2xl bg-canvas px-3 text-sm disabled:opacity-60"
                        >
                          <option value="">
                            {buses.length === 0 ? "No buses yet" : "Pick their bus"}
                          </option>
                          {buses.map((bus) => (
                            <option key={bus.id} value={bus.id}>
                              {bus.registrationNumber}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      {isAdmin && role === "manager" && modules.length > 1 ? (
                        <select
                          value={memberModules[member.userId] ?? ""}
                          disabled={pending || viewOnly}
                          onChange={(event) => void onModuleChange(member.userId, event.target.value)}
                          aria-label={`Bus types for ${member.displayName}`}
                          className="h-11 rounded-2xl bg-canvas px-3 text-sm disabled:opacity-60"
                        >
                          <option value="">All bus types</option>
                          {modules.map((item) => (
                            <option key={item} value={item}>
                              Only {MODULE_LABELS[item]}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
