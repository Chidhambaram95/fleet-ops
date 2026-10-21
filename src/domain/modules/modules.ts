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
  | "trips"
  | "fuel"
  | "intercity"
  | "buses"
  | "crew"
  | "renewals"
  | "reports";

/** Screens of each module, in menu order. Town's home is the day book itself. */
export const MODULE_SCREENS: Record<ModuleId, readonly Screen[]> = {
  town: ["home", "buses", "crew", "renewals", "reports"],
  omni: ["home", "trips", "fuel", "intercity", "daybook", "buses", "crew", "renewals", "reports"],
  tour: ["home", "trips", "fuel", "daybook", "buses", "crew", "renewals", "reports"],
};

export const SCREEN_LABELS: Record<Screen, string> = {
  home: "Home",
  daybook: "Day book",
  trips: "Trips",
  fuel: "Fuel",
  intercity: "Intercity",
  buses: "Buses",
  crew: "Crew",
  renewals: "Renewals",
  reports: "Reports",
};

export const SCREEN_HINTS: Record<Screen, string> = {
  home: "Today at a glance",
  daybook: "Daily money in and out",
  trips: "Trip sheets, approvals and advances",
  fuel: "Pump credit and mileage",
  intercity: "Fortnightly Intercity payments",
  buses: "This module's buses",
  crew: "Salaries, advances, drivers and cleaners",
  renewals: "FC, insurance, permit, tax and licences",
  reports: "Profit and loss, trips, fuel and more",
};

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

/**
 * How much of a shared cost falls on each bus. A cost with no buses picked is
 * split across every bus of the company. Rupees left over go to the first buses.
 */
export function costShares(amountInr: number, busIds: readonly string[], allBusIds: readonly string[]) {
  const targets = busIds.length ? busIds : allBusIds;
  const shares = new Map<string, number>();
  if (targets.length === 0) return shares;
  const base = Math.floor(amountInr / targets.length);
  let left = amountInr - base * targets.length;
  for (const id of targets) {
    shares.set(id, (shares.get(id) ?? 0) + base + (left > 0 ? 1 : 0));
    if (left > 0) left -= 1;
  }
  return shares;
}
