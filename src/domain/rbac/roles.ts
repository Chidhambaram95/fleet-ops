export type UserRole = "admin" | "manager" | "crew";

export const USER_ROLES: readonly UserRole[] = ["admin", "manager", "crew"] as const;

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  manager: "Manager",
  crew: "Crew",
};

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

/** Maps stored membership roles, including legacy owner / member values. */
export function normalizeUserRole(value: string): UserRole | null {
  if (value === "admin" || value === "owner") {
    return "admin";
  }
  if (value === "manager" || value === "fleet_manager" || value === "member") {
    return "manager";
  }
  if (value === "crew") {
    return "crew";
  }
  return null;
}

export function canManageBuses(role: UserRole) {
  return role === "admin";
}

export type OrganizationMember = {
  userId: string;
  displayName: string;
  role: UserRole;
  busId: string | null;
};

export type CrewAssignment = {
  busId: string;
};
