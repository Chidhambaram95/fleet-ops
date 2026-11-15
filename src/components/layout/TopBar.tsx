"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { signOut } from "@data/auth/email";
import {
  LAST_MODULE_COOKIE,
  MODULE_LABELS,
  MODULE_TITLES,
  moduleFromPath,
  moduleHref,
  type ModuleId,
} from "@domain/modules/modules";
import { canManage, ROLE_LABELS } from "@domain/rbac/roles";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { AlertsBell } from "@/components/alerts/AlertsBell";
import { useSession } from "@/components/billing/OrgContext";
import { PlusIcon } from "@/components/ui/icons";
import { useDismiss } from "@/components/ui/useDismiss";
import { addEntryHref, currentModule, initials, navLinksFor } from "./navLinks";

const MODULE_DOT: Record<ModuleId, string> = {
  town: "bg-mod-town",
  omni: "bg-mod-omni",
  tour: "bg-mod-tour",
};

/** The best match for a path: the longest menu link that contains it. */
function pageTitle(pathname: string, links: { href: string; label: string }[], module: ModuleId | null) {
  if (/\/(renewals|mileage)(\/|$)/.test(pathname)) return "Fleet health";
  const match = links
    .filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0];
  if (match) return match.label;
  return module ? MODULE_TITLES[module] : "Fleet Ops";
}

/** Page title, module switch, alerts, the main action and the account. */
export function TopBar({
  email,
  displayName,
  isSuperAdmin = false,
}: {
  email: string;
  displayName: string;
  isSuperAdmin?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { name, role, modules, defaultModule, companyArea, viewOnly } = useSession();
  const barRef = useRef<HTMLDivElement>(null);
  const accountId = useId();
  const [accountOpen, setAccountOpen] = useState(false);
  const label = displayName || email || "Signed in";
  const manager = canManage(role);
  const openModule = manager ? currentModule(pathname, modules, defaultModule) : null;
  const links = navLinksFor(role, openModule, companyArea);
  const canAdd = Boolean(role) && !viewOnly;

  useEffect(() => {
    setAccountOpen(false);
    // Remember the module opened, so Home brings people back to it. This is
    // done here, not on the server, because link prefetches would count too.
    const opened = moduleFromPath(pathname);
    if (opened) {
      document.cookie = `${LAST_MODULE_COOKIE}=${opened}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    }
  }, [pathname]);

  const closeAccount = useCallback(() => setAccountOpen(false), []);
  useDismiss(accountOpen, closeAccount, barRef);

  async function onSignOut() {
    await signOut(createBrowserSupabaseClient());
    router.replace("/login");
    router.refresh();
  }

  const showSwitch = manager && modules.length > 1;
  return (
    <header
      ref={barRef}
      className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur print:hidden"
    >
      <div className="flex h-14 items-center gap-3 px-4 lg:px-8">
        <div className="flex min-w-0 flex-col md:flex-row md:items-center md:gap-2.5">
          <span className="truncate text-xs text-muted md:hidden">
            {role ? `${label.split(" ")[0]} · ${ROLE_LABELS[role]} · ${name}` : name}
          </span>
          <div className="flex min-w-0 items-center gap-2">
            {openModule ? (
              <span aria-hidden="true" className={`hidden h-2 w-2 shrink-0 rounded-full md:block ${MODULE_DOT[openModule]}`} />
            ) : null}
            <h1 className="min-w-0 truncate text-base font-semibold text-ink">
              {manager ? pageTitle(pathname, links, openModule) : name}
            </h1>
          </div>
        </div>
        {showSwitch ? (
          <ModuleSwitch modules={modules} current={openModule} pathname={pathname} className="ml-2 hidden md:inline-flex" />
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {manager ? <AlertsBell /> : null}
          {canAdd ? (
            <Link
              href={addEntryHref(role, openModule)}
              className="hidden h-9 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-semibold text-white hover:bg-brand-dark md:inline-flex"
            >
              <PlusIcon className="h-4 w-4" />
              {openModule === "tour" ? "New enquiry" : "Add cash entry"}
            </Link>
          ) : null}
          <div className="relative">
            <button
              type="button"
              aria-label={`Account: ${label}`}
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              aria-controls={accountId}
              onClick={() => setAccountOpen((open) => !open)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-pale text-xs font-semibold text-brand-dark"
            >
              {initials(label)}
            </button>
            {accountOpen ? (
              <div
                id={accountId}
                role="menu"
                className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-surface p-2 shadow-lg"
              >
                <div className="px-3 pb-2 pt-1">
                  <p className="truncate text-sm font-semibold text-ink">{label}</p>
                  {email && email !== label ? <p className="truncate text-xs text-muted">{email}</p> : null}
                  {role ? <p className="text-xs text-muted">{ROLE_LABELS[role]}</p> : null}
                </div>
                {isSuperAdmin ? (
                  <Link
                    href="/admin/companies"
                    role="menuitem"
                    className="flex h-9 items-center rounded-md px-3 text-sm font-medium text-ink hover:bg-subtle"
                  >
                    Fleet Ops admin
                  </Link>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void onSignOut()}
                  className="flex h-9 w-full items-center rounded-md px-3 text-left text-sm font-medium text-ink hover:bg-subtle"
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {showSwitch ? (
        <div className="px-4 pb-2 md:hidden">
          <ModuleSwitch modules={modules} current={openModule} pathname={pathname} className="flex" />
        </div>
      ) : null}
    </header>
  );
}

/** Town | Omni | Tour. Each opens that module's Overview. */
export function ModuleSwitch({
  modules,
  current,
  pathname,
  className = "",
}: {
  modules: ModuleId[];
  current: ModuleId | null;
  pathname: string;
  className?: string;
}) {
  // Outside a module (company pages) no module is highlighted.
  const inModule = modules.some((item) => pathname === `/${item}` || pathname.startsWith(`/${item}/`));
  return (
    <nav aria-label="Modules" className={`rounded-lg bg-subtle p-0.5 ${className}`}>
      {modules.map((item) => {
        const active = inModule && item === current;
        return (
          <Link
            key={item}
            href={moduleHref(item)}
            aria-current={active ? "page" : undefined}
            className={`inline-flex h-8 grow items-center justify-center rounded-md px-3 text-sm ${
              active ? "bg-surface font-semibold text-ink shadow-sm" : "font-medium text-muted hover:text-ink"
            }`}
          >
            {active ? <span aria-hidden="true" className={`mr-1.5 h-2 w-2 rounded-full ${MODULE_DOT[item]}`} /> : null}
            {MODULE_LABELS[item]}
          </Link>
        );
      })}
    </nav>
  );
}
