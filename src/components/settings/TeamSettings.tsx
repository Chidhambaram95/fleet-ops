"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  assignCrewToBusAction,
  cancelInviteAction,
  createInviteAction,
  updateMemberRoleAction,
} from "@/app/(app)/settings/team/actions";
import { InviteShare } from "@/components/admin/InviteShare";
import { useOrg } from "@/components/billing/OrgContext";
import type { PendingInvite } from "@domain/companies/types";
import type { Bus } from "@domain/operations/types";
import {
  ROLE_LABELS,
  USER_ROLES,
  type OrganizationMember,
  type UserRole,
} from "@domain/rbac/roles";

export function TeamSettings({
  members,
  buses,
  invites,
  companyName,
  currentUserId,
}: {
  members: OrganizationMember[];
  buses: Bus[];
  invites: PendingInvite[];
  companyName: string;
  currentUserId: string;
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
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [fresh, setFresh] = useState<{ token: string; name: string; whatsapp: string } | null>(null);
  const [newRole, setNewRole] = useState<UserRole>("crew");
  const [newBusId, setNewBusId] = useState("");
  const [adding, setAdding] = useState(false);

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
  }, [memberKey, members]);

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

  async function addMember() {
    setAdding(true);
    setError("");
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
        <h1 className="text-2xl font-extrabold">Team</h1>
        <p className="text-sm text-muted">
          Invite a person on WhatsApp, then set their role. Crew members need one bus.
        </p>
      </div>

      {error ? <p className="text-sm text-money-out">{error}</p> : null}

      {viewOnly ? (
        <p className="rounded-3xl bg-white px-4 py-4 text-sm text-muted">
          The app is view-only until the payment is received. Invites and role changes open again after that.
        </p>
      ) : (
      <form
        className="flex flex-col gap-2 rounded-3xl bg-white p-4 md:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void addMember();
        }}
      >
        <p className="text-sm font-semibold">Invite someone</p>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Name"
          aria-label="Name"
          autoComplete="off"
          className="h-12 rounded-2xl bg-canvas px-4 text-base font-normal"
        />
        <input
          value={whatsapp}
          onChange={(event) => setWhatsapp(event.target.value)}
          placeholder="WhatsApp number"
          aria-label="WhatsApp number"
          inputMode="tel"
          autoComplete="off"
          className="h-12 rounded-2xl bg-canvas px-4 text-base font-normal"
        />
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
          {adding ? "Creating…" : "Create invite"}
        </button>
      </form>
      )}

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
                    {isSelf ? (
                      <p className="text-xs text-muted">You</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <label className="flex flex-col gap-2">
                      <span className="sr-only">Role for {member.displayName}</span>
                      <select
                        value={role}
                        disabled={isSelf || pending || viewOnly}
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
                          disabled={isSelf || pending || viewOnly || buses.length === 0}
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
