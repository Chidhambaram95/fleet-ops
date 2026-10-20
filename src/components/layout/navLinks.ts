import type { UserRole } from "@domain/rbac/roles";

/** Settings links sit in the laptop account menu instead of the top bar. */
export type NavLink = { href: string; label: string; hint: string; settings?: boolean };

/** Pages a role can open, in menu order. Home is always first. */
export function navLinksFor(role: UserRole | null): NavLink[] {
  const links: NavLink[] = [
    { href: "/", label: "Home", hint: "Today's money in and out" },
  ];
  if (role === "admin" || role === "manager") {
    links.push(
      { href: "/trips", label: "Trips", hint: "Trip sheets, approvals and advances" },
      { href: "/fuel", label: "Fuel", hint: "Pump outstanding and mileage" },
      { href: "/money", label: "Bank", hint: "Bank and company costs, Intercity income" },
      { href: "/crew", label: "Crew", hint: "Salaries, open advances, drivers and cleaners" },
      { href: "/renewals", label: "Renewals", hint: "FC, insurance, permit, tax and licences" },
      { href: "/reports", label: "Reports", hint: "Profit and loss, trips, fuel and more" },
      {
        href: "/fleet",
        label: "Buses",
        hint: role === "admin" ? "Add or change your buses" : "See your buses",
      },
    );
  }
  if (role === "admin") {
    links.push(
      { href: "/settings/team", label: "Team", hint: "Invite people and set their role", settings: true },
      { href: "/settings/company", label: "Company", hint: "Name, WhatsApp number and plan", settings: true },
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
