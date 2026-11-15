import {
  moduleFromPath,
  moduleHref,
  navScreens,
  NAV_GROUP_LABELS,
  SCREEN_HINTS,
  screenLabel,
  SCREENS,
  type ModuleId,
  type NavGroup,
} from "@domain/modules/modules";
import { canManage, type UserRole } from "@domain/rbac/roles";
import type { NavIconName } from "@/components/ui/icons";

/** `group` is where the sidebar and the Menu page file it; the Company links have their own group. */
export type NavLink = {
  href: string;
  label: string;
  hint: string;
  icon: NavIconName;
  group: NavGroup | "company";
  /** Company pages are not tied to a module. */
  settings?: boolean;
};

export const NAV_GROUP_TITLES: Record<NavGroup | "company", string> = {
  ...NAV_GROUP_LABELS,
  company: "Company",
};

/** The menu of one module, in order. Overview is always first. */
export function moduleLinks(module: ModuleId): NavLink[] {
  return navScreens(module).map((screen) => ({
    href: moduleHref(module, screen),
    label: screenLabel(module, screen),
    hint: SCREEN_HINTS[screen],
    icon: screen === "home" ? "overview" : (screen as NavIconName),
    group: SCREENS[screen].group,
  }));
}

/** Pages that belong to the whole company, outside the modules. */
export function companyLinks(role: UserRole | null, companyArea: boolean): NavLink[] {
  const links: NavLink[] = [];
  if (companyArea) {
    links.push(
      { href: "/company/costs", label: "Company costs", hint: "Loan EMI, auditor, office and workshop bills", icon: "costs", group: "company", settings: true },
      { href: "/company/reports", label: "All buses report", hint: "Profit and loss across every module", icon: "allbuses", group: "company", settings: true },
    );
  }
  if (canManage(role)) {
    links.push({ href: "/history", label: "Change history", hint: "Who changed which money record, and why", icon: "history", group: "company", settings: true });
  }
  if (role === "admin") {
    links.push(
      { href: "/settings/team", label: "Team & logins", hint: "Add people, set passwords and roles", icon: "team", group: "company", settings: true },
      { href: "/settings/company", label: "Company settings", hint: "Name, WhatsApp number and bus types", icon: "settings", group: "company", settings: true },
    );
  } else if (role === "manager") {
    links.push({ href: "/settings/team", label: "Team", hint: "Everyone in the company; remove crew who left", icon: "team", group: "company", settings: true });
  }
  return links;
}

/** Links of a module and the company area, grouped for the sidebar and the Menu page. */
export function groupedLinks(links: NavLink[]): { group: NavGroup | "company"; title: string; links: NavLink[] }[] {
  const order: (NavGroup | "company")[] = ["monitor", "work", "fleet", "reports", "company"];
  return order
    .map((group) => ({ group, title: NAV_GROUP_TITLES[group], links: links.filter((link) => link.group === group) }))
    .filter((entry) => entry.links.length > 0);
}

/** Pages a person can open: crew get their day book; others their current module and the Company area. */
export function navLinksFor(
  role: UserRole | null,
  module: ModuleId | null,
  companyArea = false,
): NavLink[] {
  if (!canManage(role)) {
    return [{ href: "/", label: "Today", hint: "Today's money in and out", icon: "daybook", group: "work" }];
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
  if (module === "tour") return "/tour/enquiries?new=1";
  return `${moduleHref(module, "daybook")}?add=income`;
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
