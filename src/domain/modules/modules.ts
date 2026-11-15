import { BUS_TYPES, type BusType } from "@domain/companies/types";

/** Each bus type is its own module of the app, with its own menu and screens. */
export type ModuleId = BusType;

export const MODULES: readonly ModuleId[] = BUS_TYPES;

/** Cookie holding the module someone last opened. */
export const LAST_MODULE_COOKIE = "fleetops_module";

export const MODULE_LABELS: Record<ModuleId, string> = {
  town: "Town",
  omni: "Omni",
  tour: "Tour",
};

export const MODULE_TITLES: Record<ModuleId, string> = {
  town: "Town buses",
  omni: "Omni buses",
  tour: "Tour buses",
};

export type Screen =
  | "home"
  | "health"
  | "daybook"
  | "enquiries"
  | "bookings"
  | "trips"
  | "fuel"
  | "mileage"
  | "intercity"
  | "buses"
  | "crew"
  | "renewals"
  | "tyres"
  | "reports";

/**
 * Screens of each module, in menu order. Every module opens on its Overview.
 * Mileage and Documents due are still screens (they have routes and access checks)
 * but are reached from Fleet health, so the menus leave them out (see NAV_HIDDEN).
 */
export const MODULE_SCREENS: Record<ModuleId, readonly Screen[]> = {
  town: ["home", "health", "daybook", "buses", "mileage", "crew", "renewals", "tyres", "reports"],
  omni: ["home", "health", "daybook", "trips", "fuel", "intercity", "buses", "mileage", "crew", "renewals", "tyres", "reports"],
  tour: ["home", "health", "enquiries", "bookings", "trips", "fuel", "buses", "mileage", "crew", "renewals", "tyres", "reports"],
};

/** Screens that live under Fleet health instead of having a menu entry of their own. */
export const NAV_HIDDEN: readonly Screen[] = ["mileage", "renewals"];

/** The screens a module shows in its menus, in order. */
export function navScreens(module: ModuleId): Screen[] {
  return MODULE_SCREENS[module].filter((screen) => !NAV_HIDDEN.includes(screen));
}

/** How the menu groups screens: what to watch, daily work, the fleet itself, and reports. */
export type NavGroup = "monitor" | "work" | "fleet" | "reports";

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  monitor: "Monitor",
  work: "Daily work",
  fleet: "Fleet",
  reports: "Reports",
};

/** Everything the menus need to know about a screen, in one place. Add a screen here and in MODULE_SCREENS. */
export const SCREENS: Record<Screen, { label: string; hint: string; group: NavGroup }> = {
  home: { label: "Overview", hint: "Today and this month at a glance", group: "monitor" },
  health: { label: "Fleet health", hint: "Documents, mileage, loans and EMIs", group: "monitor" },
  daybook: { label: "Day book", hint: "Daily money in and out", group: "work" },
  enquiries: { label: "Enquiries & quotes", hint: "New enquiries, quotes and advances", group: "work" },
  bookings: { label: "Bookings", hint: "Confirmed tours, payments and balances", group: "work" },
  trips: { label: "Trip sheets", hint: "Trip sheets, approvals and advances", group: "work" },
  fuel: { label: "Diesel & pumps", hint: "Pump credit owed", group: "work" },
  mileage: { label: "Mileage", hint: "Km per litre and alerts for each bus", group: "monitor" },
  intercity: { label: "Intercity payments", hint: "Fortnightly Intercity payments", group: "work" },
  buses: { label: "Buses", hint: "This module's buses", group: "fleet" },
  crew: { label: "Crew", hint: "Salaries, advances and your crew", group: "fleet" },
  renewals: { label: "Documents due", hint: "FC, insurance, permit, tax and licences", group: "monitor" },
  tyres: { label: "Tyres", hint: "Tyres on each bus, km, retreads and warranty", group: "fleet" },
  reports: { label: "Reports", hint: "Profit and loss, trips, fuel and more", group: "reports" },
};

const screenField = <K extends "label" | "hint">(key: K) =>
  Object.fromEntries(Object.entries(SCREENS).map(([screen, def]) => [screen, def[key]])) as Record<Screen, string>;

export const SCREEN_LABELS: Record<Screen, string> = screenField("label");

export const SCREEN_HINTS: Record<Screen, string> = screenField("hint");

export function screenLabel(_module: ModuleId, screen: Screen) {
  return SCREEN_LABELS[screen];
}

/** The second tab on the phone: the day book, or Enquiries for Tour. */
export function secondTabScreen(module: ModuleId): Screen {
  return module === "tour" ? "enquiries" : "daybook";
}

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === "string" && (MODULES as readonly string[]).includes(value);
}

export function hasScreen(module: ModuleId, screen: Screen) {
  return MODULE_SCREENS[module].includes(screen);
}

export function moduleHref(module: ModuleId, screen: Screen = "home") {
  return screen === "home" ? `/${module}` : `/${module}/${screen}`;
}

/** Modules the company uses: allowed by the super admin and switched on by the company admin. */
export function activeModules(allowed: readonly BusType[], enabled: readonly BusType[] | null): ModuleId[] {
  return MODULES.filter((module) => allowed.includes(module) && (!enabled || enabled.includes(module)));
}

/** Modules one person may open. A manager can be limited to one; admins see every active module. */
export function modulesForMember(
  active: readonly ModuleId[],
  role: string | null,
  memberModule: ModuleId | null,
): ModuleId[] {
  if (role === "manager" && memberModule) {
    return active.filter((module) => module === memberModule);
  }
  return [...active];
}

/** The module in a path such as /omni/trips, if any. */
export function moduleFromPath(pathname: string): ModuleId | null {
  const first = pathname.split("/")[1];
  return isModuleId(first) ? first : null;
}
