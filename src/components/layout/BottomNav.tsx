"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PlusIcon } from "./AppHeader";
import { moduleHref, screenLabel, secondTabScreen, type ModuleId } from "@domain/modules/modules";
import type { UserRole } from "@domain/rbac/roles";
import { addEntryHref, currentModule, isActive } from "./navLinks";

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
  const openModule = role === "admin" || role === "manager" ? currentModule(pathname, modules, defaultModule) : null;
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

function HomeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </svg>
  );
}

function SheetIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
