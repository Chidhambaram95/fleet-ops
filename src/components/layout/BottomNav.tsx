"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { moduleHref, screenLabel, secondTabScreen } from "@domain/modules/modules";
import { canManage } from "@domain/rbac/roles";
import { useAlerts } from "@/components/alerts/AlertsProvider";
import { useSession } from "@/components/billing/OrgContext";
import { MenuIcon, NavIcon, PlusIcon } from "@/components/ui/icons";
import { addEntryHref, currentModule, isActive } from "./navLinks";

/**
 * Phone-only tabs: Overview, Day book (Enquiries in Tour), a big + for a new
 * entry, Fleet health with the alert count, and Menu. Crew get Today, + and Menu.
 */
export function BottomNav() {
  const pathname = usePathname();
  const { role, modules, defaultModule, viewOnly } = useSession();
  const alerts = useAlerts();
  const manager = canManage(role);
  const canAdd = Boolean(role) && !viewOnly;
  const openModule = manager ? currentModule(pathname, modules, defaultModule) : null;
  const homeHref = openModule ? moduleHref(openModule) : "/";
  const secondScreen = openModule ? secondTabScreen(openModule) : null;
  const secondHref = openModule && secondScreen ? moduleHref(openModule, secondScreen) : "";
  const healthHref = openModule ? moduleHref(openModule, "health") : "";
  const homeActive = isActive(pathname, homeHref);
  const secondActive = Boolean(openModule) && isActive(pathname, secondHref);
  const healthActive = Boolean(openModule) && (isActive(pathname, healthHref) || /\/(renewals|mileage)(\/|$)/.test(pathname));
  const menuActive = !homeActive && !secondActive && !healthActive;
  const tab = (active: boolean) =>
    `flex flex-col items-center justify-center gap-0.5 text-xs ${
      active ? "font-semibold text-brand" : "font-medium text-muted"
    }`;

  return (
    <nav
      aria-label="Main"
      className={`fixed inset-x-0 bottom-0 z-40 grid ${openModule ? "grid-cols-5" : "grid-cols-3"} items-center border-t border-line bg-surface px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-1.5 md:hidden print:hidden`}
    >
      <Link href={homeHref} aria-current={homeActive ? "page" : undefined} className={tab(homeActive)}>
        <NavIcon name={openModule ? "overview" : "daybook"} className="h-[22px] w-[22px]" />
        {openModule ? screenLabel(openModule, "home") : "Today"}
      </Link>
      {openModule && secondScreen ? (
        <Link href={secondHref} aria-current={secondActive ? "page" : undefined} className={tab(secondActive)}>
          <NavIcon name={secondScreen === "daybook" ? "daybook" : "enquiries"} className="h-[22px] w-[22px]" />
          {screenLabel(openModule, secondScreen)}
        </Link>
      ) : null}
      {canAdd ? (
        <Link
          href={addEntryHref(role, openModule)}
          aria-label={openModule === "tour" ? "New enquiry" : "Add cash entry"}
          className="-mt-6 flex h-14 w-14 items-center justify-center justify-self-center rounded-full bg-brand text-white shadow-lg"
        >
          <PlusIcon className="h-7 w-7" />
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      {openModule ? (
        <Link href={healthHref} aria-current={healthActive ? "page" : undefined} className={`relative ${tab(healthActive)}`}>
          <NavIcon name="health" className="h-[22px] w-[22px]" />
          Fleet health
          {alerts.count ? (
            <span className="absolute right-1/4 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-money-out px-1 text-xs font-semibold text-white">
              {alerts.count}
            </span>
          ) : null}
        </Link>
      ) : null}
      <Link href="/more" aria-current={menuActive ? "page" : undefined} className={tab(menuActive)}>
        <MenuIcon />
        Menu
      </Link>
    </nav>
  );
}
