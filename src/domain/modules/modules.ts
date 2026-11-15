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

/** Screens of each module, in menu order. Town's home is the day book itself. */
export const MODULE_SCREENS: Record<ModuleId, readonly Screen[]> = {
  town: ["home", "buses", "mileage", "crew", "renewals", "tyres", "reports"],
  omni: ["home", "trips", "fuel", "mileage", "intercity", "daybook", "buses", "crew", "renewals", "tyres", "reports"],
  tour: ["home", "enquiries", "bookings", "trips", "fuel", "mileage", "buses", "crew", "renewals", "tyres", "reports"],
};

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
  home: { label: "Today", hint: "Today at a glance", group: "monitor" },
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

/** Omni and Tour open on an overview of what needs doing; Town on today's cash. */
export function screenLabel(module: ModuleId, screen: Screen) {
  return screen === "home" && module !== "town" ? "Overview" : SCREEN_LABELS[screen];
}

/** The second tab on the phone: Trip sheets, or Enquiries for Tour, or Crew where there are no trips. */
export function secondTabScreen(module: ModuleId): Screen {
  if (module === "tour") return "enquiries";
  return hasScreen(module, "trips") ? "trips" : "crew";
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
