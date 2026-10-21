import {
  MODULE_SCREENS,
  moduleFromPath,
  moduleHref,
  SCREEN_HINTS,
  SCREEN_LABELS,
  type ModuleId,
} from "@domain/modules/modules";
import type { UserRole } from "@domain/rbac/roles";

/** Settings links sit in the laptop account menu instead of the top bar. */
export type NavLink = { href: string; label: string; hint: string; settings?: boolean };

/** The menu of one module, in order. Home is always first. */
export function moduleLinks(module: ModuleId): NavLink[] {
  return MODULE_SCREENS[module].map((screen) => ({
    href: moduleHref(module, screen),
    label: SCREEN_LABELS[screen],
    hint: SCREEN_HINTS[screen],
  }));
}

/** Pages that belong to the whole company, outside the modules. */
export function companyLinks(role: UserRole | null, companyArea: boolean): NavLink[] {
  const links: NavLink[] = [];
  if (companyArea) {
    links.push(
      { href: "/company/costs", label: "Bank & company costs", hint: "Loan EMI, auditor, office and workshop bills", settings: true },
      { href: "/company/reports", label: "Combined report", hint: "Profit and loss across every module", settings: true },
    );
  }
  if (role === "admin") {
    links.push(
      { href: "/settings/team", label: "Team", hint: "Invite people and set their role", settings: true },
      { href: "/settings/company", label: "Company", hint: "Name, WhatsApp number and modules", settings: true },
    );
  }
  return links;
}

/** Pages a person can open: crew get their day book; others their current module and the Company area. */
export function navLinksFor(
  role: UserRole | null,
  module: ModuleId | null,
  companyArea = false,
): NavLink[] {
  if (role !== "admin" && role !== "manager") {
    return [{ href: "/", label: "Home", hint: "Today's money in and out" }];
  }
  return [...(module ? moduleLinks(module) : []), ...companyLinks(role, companyArea)];
}

/** The module being looked at: from the address, else the person's usual one. */
export function currentModule(
  pathname: string,
  modules: readonly ModuleId[],
  fallback: ModuleId | null,
): ModuleId | null {
  const fromPath = moduleFromPath(pathname);
  if (fromPath && modules.includes(fromPath)) return fromPath;
  return fallback && modules.includes(fallback) ? fallback : (modules[0] ?? null);
}

/** Where "Add entry" opens the day book. */
export function addEntryHref(role: UserRole | null, module: ModuleId | null) {
  if (role === "crew" || !module) return "/?add=income";
  return module === "town" ? "/town?add=income" : `${moduleHref(module, "daybook")}?add=income`;
}

export function isActive(pathname: string, href: string) {
  // "/" and a module's home ("/omni") match only themselves.
  if (href === "/" || href.split("/").length === 2) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
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
