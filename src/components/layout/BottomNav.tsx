"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { moduleHref, screenLabel, secondTabScreen, type ModuleId } from "@domain/modules/modules";
import { canManage, type UserRole } from "@domain/rbac/roles";
import { addEntryHref, currentModule, isActive } from "./navLinks";
import { PlusIcon, HomeIcon, ChartIcon, SheetIcon, MenuIcon } from "@/components/ui/icons";

/**
 * Phone-only tabs: the module's Home, Trips (Crew in Town), a big + for a new
 * entry, Reports and More. Crew get Home, + and More.
 */
export function BottomNav({
  canAdd,
  role,
  modules = [],
  defaultModule = null,
}: {
  canAdd: boolean;
  role: UserRole | null;
  modules?: ModuleId[];
  defaultModule?: ModuleId | null;
}) {
  const pathname = usePathname();
  const openModule = canManage(role) ? currentModule(pathname, modules, defaultModule) : null;
  const homeHref = openModule ? moduleHref(openModule) : "/";
  const secondScreen = openModule ? secondTabScreen(openModule) : "crew";
  const secondHref = openModule ? moduleHref(openModule, secondScreen) : "";
  const reportsHref = openModule ? moduleHref(openModule, "reports") : "";
  const homeActive = isActive(pathname, homeHref);
  const secondActive = Boolean(openModule) && isActive(pathname, secondHref);
  const reportsActive = Boolean(openModule) && isActive(pathname, reportsHref);
  const moreActive = !homeActive && !secondActive && !reportsActive;
  const tab = (active: boolean) =>
    `flex flex-col items-center justify-center gap-0.5 text-[11px] ${
      active ? "font-bold text-brand" : "font-medium text-muted"
    }`;

  return (
    <nav
      aria-label="Main"
      className={`fixed inset-x-0 bottom-0 z-40 grid ${openModule ? "grid-cols-5" : "grid-cols-3"} items-center rounded-t-3xl bg-white px-2 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-2px_12px_rgba(26,27,46,0.08)] md:hidden print:hidden`}
    >
      <Link href={homeHref} aria-current={homeActive ? "page" : undefined} className={tab(homeActive)}>
        <HomeIcon />
        {openModule ? screenLabel(openModule, "home") : "Today"}
      </Link>
      {openModule ? (
        <Link href={secondHref} aria-current={secondActive ? "page" : undefined} className={tab(secondActive)}>
          <SheetIcon />
          {screenLabel(openModule, secondScreen)}
        </Link>
      ) : null}
      {canAdd ? (
        <Link
          href={addEntryHref(role, openModule)}
          aria-label="Add cash entry"
          className="-mt-7 flex h-14 w-14 items-center justify-center justify-self-center rounded-full bg-brand text-white shadow-[0_6px_16px_rgba(58,63,184,0.35)]"
        >
          <PlusIcon className="h-7 w-7" />
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      {openModule ? (
        <Link href={reportsHref} aria-current={reportsActive ? "page" : undefined} className={tab(reportsActive)}>
          <ChartIcon />
          Reports
        </Link>
      ) : null}
      <Link href="/more" aria-current={moreActive ? "page" : undefined} className={tab(moreActive)}>
        <MenuIcon />
        Menu
      </Link>
    </nav>
  );
}

