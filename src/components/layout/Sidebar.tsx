"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { canManage } from "@domain/rbac/roles";
import { useAlerts } from "@/components/alerts/AlertsProvider";
import { useSession } from "@/components/billing/OrgContext";
import { NavIcon } from "@/components/ui/icons";
import { companyLinks, currentModule, groupedLinks, isActive, moduleLinks, type NavLink } from "./navLinks";

/** True when the page belongs to this link; Fleet health also covers the Documents and Mileage pages. */
function linkIsActive(pathname: string, link: NavLink) {
  if (isActive(pathname, link.href)) return true;
  return link.icon === "health" && /\/(renewals|mileage)(\/|$)/.test(pathname);
}

/** Laptop: a 240 px menu grouped by job. Tablet: a 64 px icon rail. Phones use the bottom bar. */
export function Sidebar() {
  const pathname = usePathname();
  const { name, role, modules, defaultModule, companyArea } = useSession();
  const alerts = useAlerts();
  if (!canManage(role)) return null;

  const openModule = currentModule(pathname, modules, defaultModule);
  const links = [...(openModule ? moduleLinks(openModule) : []), ...companyLinks(role, companyArea)];
  const sections = groupedLinks(links);

  return (
    <aside className="hidden print:hidden md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:gap-1 md:overflow-y-auto md:border-r md:border-line md:bg-surface md:px-2 md:py-3 lg:px-3">
      <div className="flex h-12 items-center gap-2.5 px-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-semibold text-white">
          F
        </span>
        <div className="hidden min-w-0 flex-col lg:flex">
          <span className="text-sm font-semibold text-ink">Fleet Ops</span>
          <span className="truncate text-xs text-muted">{name}</span>
        </div>
      </div>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {sections.map((section) => (
          <div key={section.group} className="flex flex-col gap-0.5">
            <p className="mt-4 hidden px-2.5 pb-1 text-xs font-medium uppercase tracking-wide text-muted lg:block">
              {section.title}
            </p>
            <div className="mt-3 hidden border-t border-line md:block lg:hidden" aria-hidden="true" />
            {section.links.map((link) => {
              const active = linkIsActive(pathname, link);
              const badge = link.icon === "health" ? alerts.count : 0;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  title={link.label}
                  aria-label={link.label}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex h-9 items-center justify-center gap-2.5 rounded-md text-sm lg:justify-start lg:px-2.5 ${
                    active
                      ? "bg-brand-soft font-semibold text-brand-dark"
                      : "font-medium text-muted hover:bg-subtle hover:text-ink"
                  }`}
                >
                  <NavIcon name={link.icon} />
                  <span className="hidden lg:inline">{link.label}</span>
                  {badge ? (
                    <span className="absolute right-1 top-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-money-out px-1.5 text-xs font-semibold text-white lg:static lg:ml-auto">
                      {badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

