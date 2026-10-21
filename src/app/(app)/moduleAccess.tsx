import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getActiveMembership, type ActiveMembership } from "@data/auth/session";
import { getCompanyProfile, getMemberModule } from "@data/companies/repository";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import {
  activeModules,
  hasScreen,
  isModuleId,
  LAST_MODULE_COOKIE,
  moduleHref,
  modulesForMember,
  type ModuleId,
  type Screen,
} from "@domain/modules/modules";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * The company's switched-on modules, and the ones this person may open
 * (a manager can be limited to one), in menu order.
 */
export async function moduleInfo(
  membership: ActiveMembership,
): Promise<{ active: ModuleId[]; mine: ModuleId[]; limited: boolean }> {
  const supabase = await createServerSupabaseClient();
  const [profile, memberModule] = await Promise.all([
    getCompanyProfile(supabase, membership.organizationId),
    getMemberModule(supabase, membership.organizationId, membership.userId),
  ]);
  const active = activeModules(profile.busTypes, profile.enabledModules);
  const mine = modulesForMember(active, membership.role, memberModule);
  return { active, mine, limited: mine.length < active.length };
}

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
    membership = await getActiveMembership(await createServerSupabaseClient());
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

/**
 * The Company area (costs, combined report) is for admins, and for managers
 * who are not limited to one module.
 */
export async function companyAccess(): Promise<
  | { membership: ActiveMembership; companyModules: ModuleId[]; message?: never }
  | { membership?: never; companyModules?: never; message: string }
> {
  if (!hasPublicSupabaseEnv()) {
    return { message: "Add Supabase keys to .env.local first." };
  }
  let membership: ActiveMembership;
  try {
    membership = await getActiveMembership(await createServerSupabaseClient());
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Could not load this page." };
  }
  if (membership.role === "crew") redirect("/");
  const info = await moduleInfo(membership);
  if (membership.role !== "admin" && info.limited) {
    return { message: "Only admins can open the company pages." };
  }
  return { membership, companyModules: info.active };
}

/** Old single-app links (/trips, /fuel …) open the same screen in the person's module. */
export async function redirectToModuleScreen(screen: Screen, rest = ""): Promise<never> {
  const membership = await getActiveMembership(await createServerSupabaseClient()).catch(() => null);
  if (!membership || membership.role === "crew") redirect("/");
  const modules = await myModules(membership);
  const last = (await cookies()).get(LAST_MODULE_COOKIE)?.value;
  const ordered = isModuleId(last) && modules.includes(last) ? [last, ...modules] : modules;
  const target = ordered.find((module) => hasScreen(module, screen));
  redirect(target ? `${moduleHref(target, screen)}${rest}` : "/");
}
