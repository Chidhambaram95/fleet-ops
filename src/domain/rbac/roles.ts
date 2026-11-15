export type UserRole = "admin" | "manager" | "crew";

export const USER_ROLES: readonly UserRole[] = ["admin", "manager", "crew"] as const;

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  manager: "Manager",
  crew: "Crew",
};

/** Admins and managers: the people who run the company day to day. */
export function canManage(role: UserRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

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

export type OrganizationMember = {
  userId: string;
  displayName: string;
  role: UserRole;
  busId: string | null;
  /** A manager limited to one module; null means every module. */
  module: "town" | "omni" | "tour" | null;
};

export type CrewAssignment = {
  busId: string;
};
