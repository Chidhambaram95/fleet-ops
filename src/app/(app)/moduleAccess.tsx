import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache, type ReactNode } from "react";
import {
  getRequestCompanyProfile,
  getRequestMemberModule,
  getRequestMembership,
  getRequestMembershipOrNull,
} from "@data/auth/requestSession";
import type { ActiveMembership } from "@data/auth/session";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { AccessMessage } from "./editorAccess";
import {
  activeModules,
  hasScreen,
  isModuleId,
  LAST_MODULE_COOKIE,
  MODULE_TITLES,
  moduleHref,
  modulesForMember,
  type ModuleId,
  type Screen,
} from "@domain/modules/modules";

/**
 * The company's switched-on modules, and the ones this person may open
 * (a manager can be limited to one), in menu order.
 */
export const moduleInfo = cache(
  async (membership: ActiveMembership): Promise<{ active: ModuleId[]; mine: ModuleId[]; limited: boolean }> => {
    const [profile, memberModule] = await Promise.all([
      getRequestCompanyProfile(membership.organizationId),
      getRequestMemberModule(membership.organizationId, membership.userId),
    ]);
    const active = activeModules(profile.busTypes, profile.enabledModules);
    const mine = modulesForMember(active, membership.role, memberModule);
    return { active, mine, limited: mine.length < active.length };
  },
);

/** The modules a signed-in admin or manager may open, in menu order. */
export async function myModules(membership: ActiveMembership): Promise<ModuleId[]> {
  return (await moduleInfo(membership)).mine;
}

/** Where Home takes an admin or manager: the module they last used, else the first one. */
export async function homeModule(
  membership: ActiveMembership,
  known?: ModuleId[],
): Promise<ModuleId | null> {
  const modules = known ?? (await myModules(membership));
  const last = (await cookies()).get(LAST_MODULE_COOKIE)?.value;
  if (isModuleId(last) && modules.includes(last)) return last;
  return modules[0] ?? null;
}

/**
 * Checks a module page: the module exists, the company has it switched on,
 * this person may open it, and the module has this screen. Crew go home.
 */
export async function moduleAccess(
  param: string,
  screen: Screen,
): Promise<
  | { membership: ActiveMembership; module: ModuleId; companyModules: ModuleId[]; message?: never }
  | { membership?: never; module?: never; companyModules?: never; message: string }
> {
  if (!isModuleId(param) || !hasScreen(param, screen)) notFound();
  if (!hasPublicSupabaseEnv()) {
    return { message: "Add Supabase keys to .env.local first." };
  }
  let membership: ActiveMembership;
  try {
    membership = await getRequestMembership();
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Could not load this page." };
  }
  if (membership.role === "crew") redirect("/");
  const { active, mine: modules } = await moduleInfo(membership);
  if (!modules.includes(param)) {
    if (modules.length) redirect(moduleHref(modules[0]));
    return {
      message:
        membership.role === "admin"
          ? "No bus types are switched on. Turn one on in Company settings."
          : "You don't have a bus type to open yet. Ask your admin.",
    };
  }
  return { membership, module: param, companyModules: active };
}

/** What a module page gets once access is granted. */
export type ModuleGrant = { membership: ActiveMembership; module: ModuleId; companyModules: ModuleId[] };

/**
 * Wraps a module page: checks access with moduleAccess() and shows the reason
 * when it is refused, otherwise renders the page with the grant.
 */
export async function withModule(
  params: Promise<{ module: string }>,
  screen: Screen,
  render: (access: ModuleGrant) => ReactNode,
): Promise<ReactNode> {
  const access = await moduleAccess((await params).module, screen);
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return render(access);
}

/**
 * The Company area (costs, combined report) is for admins, and for managers
 * who are not limited to one module.
 */
export async function companyAccess(): Promise<
  | { membership: ActiveMembership; companyModules: ModuleId[]; message?: never }
  | { membership?: never; companyModules?: never; message: string; link?: { href: string; label: string } }
> {
  if (!hasPublicSupabaseEnv()) {
    return { message: "Add Supabase keys to .env.local first." };
  }
  let membership: ActiveMembership;
  try {
    membership = await getRequestMembership();
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Could not load this page." };
  }
  if (membership.role === "crew") redirect("/");
  const info = await moduleInfo(membership);
  if (membership.role !== "admin" && info.limited) {
    const own = info.mine.find((module) => hasScreen(module, "reports"));
    return {
      message:
        "Company pages cover every bus type, so they're for admins and managers of all bus types. Ask your admin if you need Company costs or the all-buses report.",
      link: own ? { href: moduleHref(own, "reports"), label: `Open ${MODULE_TITLES[own]} reports ›` } : undefined,
    };
  }
  return { membership, companyModules: info.active };
}

/** Old single-app links (/trips, /fuel …) open the same screen in the person's module. */
export async function redirectToModuleScreen(screen: Screen, rest = ""): Promise<never> {
  const membership = await getRequestMembershipOrNull();
  if (!membership || membership.role === "crew") redirect("/");
  const modules = await myModules(membership);
  const last = (await cookies()).get(LAST_MODULE_COOKIE)?.value;
  const ordered = isModuleId(last) && modules.includes(last) ? [last, ...modules] : modules;
  const target = ordered.find((module) => hasScreen(module, screen));
  redirect(target ? `${moduleHref(target, screen)}${rest}` : "/");
}
