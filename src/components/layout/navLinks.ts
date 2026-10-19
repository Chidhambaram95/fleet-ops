import type { UserRole } from "@domain/rbac/roles";

export type NavLink = { href: string; label: string; hint: string };

/** Pages a role can open, in menu order. Home is always first. */
export function navLinksFor(role: UserRole | null): NavLink[] {
  const links: NavLink[] = [
    { href: "/", label: "Home", hint: "Today's money in and out" },
  ];
  if (role === "admin" || role === "manager") {
    links.push({
      href: "/fleet",
      label: "Buses",
      hint: role === "admin" ? "Add or change your buses" : "See your buses",
    });
  }
  if (role === "admin") {
    links.push(
      { href: "/settings/team", label: "Team", hint: "Invite people and set their role" },
      { href: "/settings/company", label: "Company", hint: "Name, WhatsApp number and plan" },
    );
  }
  return links;
}

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function initials(value: string) {
  const parts = value
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}
