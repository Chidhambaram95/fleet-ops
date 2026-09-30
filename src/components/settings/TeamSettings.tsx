"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  assignCrewToBusAction,
  createMemberAction,
  updateMemberRoleAction,
} from "@/app/(app)/settings/team/actions";
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
  currentUserId,
}: {
  members: OrganizationMember[];
  buses: Bus[];
  currentUserId: string;
}) {
  const router = useRouter();
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    const result = await createMemberAction({
      displayName,
      email,
      password,
      role: newRole,
      busId: newBusId,
    });
    setAdding(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDisplayName("");
    setEmail("");
    setPassword("");
    setNewRole("crew");
    setNewBusId("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Team</h1>
        <p className="text-sm text-stone-600">
          Add a person, then set their role. Crew members need one assigned vehicle.
        </p>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <form
        className="flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void addMember();
        }}
      >
        <p className="text-sm font-semibold">Add user</p>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Name"
          aria-label="Name"
          autoComplete="off"
          className="rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-normal"
        />
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          aria-label="Email"
          autoComplete="off"
          className="rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-normal"
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Temporary password"
          aria-label="Temporary password"
          autoComplete="new-password"
          className="rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-normal"
        />
        <label className="flex flex-col gap-1 text-sm font-medium">
          Role
          <select
            value={newRole}
            onChange={(event) => setNewRole(event.target.value as UserRole)}
            className="rounded-xl border border-stone-200 bg-stone-50 px-2 text-sm"
          >
            {USER_ROLES.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        {newRole === "crew" ? (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Vehicle
            <select
              value={newBusId}
              onChange={(event) => setNewBusId(event.target.value)}
              className="rounded-xl border border-stone-200 bg-stone-50 px-2 text-sm"
            >
              <option value="">
                {buses.length === 0 ? "No buses yet" : "Assign a vehicle"}
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
          className="rounded-xl bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {adding ? "Adding…" : "Add user"}
        </button>
      </form>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
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
                <tr key={member.userId} className="border-b border-stone-100 align-top">
                  <td className="px-3 py-3">
                    <p className="font-medium">{member.displayName}</p>
                    {isSelf ? (
                      <p className="text-xs text-stone-500">You</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <label className="flex flex-col gap-2">
                      <span className="sr-only">Role for {member.displayName}</span>
                      <select
                        value={role}
                        disabled={isSelf || pending}
                        onChange={(event) =>
                          onRoleChange(member, event.target.value as UserRole)
                        }
                        className="rounded-xl border border-stone-200 bg-stone-50 px-2 text-sm disabled:opacity-60"
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
                          disabled={isSelf || pending || buses.length === 0}
                          onChange={(event) =>
                            onBusChange(member.userId, event.target.value)
                          }
                          aria-label={`Vehicle for ${member.displayName}`}
                          className="rounded-xl border border-stone-200 bg-stone-50 px-2 text-sm disabled:opacity-60"
                        >
                          <option value="">
                            {buses.length === 0 ? "No buses yet" : "Assign a vehicle"}
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
