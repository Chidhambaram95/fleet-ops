export type UserRole = "admin" | "fleet_manager" | "crew";

export const USER_ROLES: readonly UserRole[] = [
  "admin",
  "fleet_manager",
  "crew",
] as const;

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}
