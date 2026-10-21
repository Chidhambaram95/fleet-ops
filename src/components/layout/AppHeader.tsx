"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "@data/auth/email";
import {
  LAST_MODULE_COOKIE,
  MODULE_LABELS,
  moduleFromPath,
  moduleHref,
  type ModuleId,
} from "@domain/modules/modules";
import { ROLE_LABELS, type UserRole } from "@domain/rbac/roles";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { addEntryHref, currentModule, initials, isActive, navLinksFor } from "./navLinks";

/** Phone: company name and account button. Laptop: logo, top menu and account. */
export function AppHeader({
  organizationName,
  email,
  displayName,
  role,
  isSuperAdmin = false,
  canAdd = true,
  modules = [],
  defaultModule = null,
  companyArea = false,
}: {
  organizationName: string;
  email: string;
  displayName: string;
  role: UserRole | null;
  isSuperAdmin?: boolean;
  canAdd?: boolean;
  /** Modules this person may open. */
  modules?: ModuleId[];
  /** The module shown outside module pages: the one used last. */
  defaultModule?: ModuleId | null;
  /** Bank and company costs and the combined report. */
  companyArea?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const accountId = useId();
  const [accountOpen, setAccountOpen] = useState(false);
  const label = displayName || email || "Signed in";
  const openModule = role === "crew" ? null : currentModule(pathname, modules, defaultModule);
  const links = navLinksFor(role, openModule, companyArea);

  useEffect(() => {
    setAccountOpen(false);
    // Remember the module opened, so Home brings people back to it. This is
    // done here, not on the server, because link prefetches would count too.
    const opened = moduleFromPath(pathname);
    if (opened) {
      document.cookie = `${LAST_MODULE_COOKIE}=${opened}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    }
  }, [pathname]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!headerRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAccountOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  async function onSignOut() {
    await signOut(createBrowserSupabaseClient());
    router.replace("/login");
    router.refresh();
  }

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-40 bg-canvas/95 backdrop-blur md:bg-white print:hidden"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 pb-2 pt-4 md:px-8 md:py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand font-extrabold text-white md:flex">
            F
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] text-muted md:hidden">
              {role ? `${label.split(" ")[0]} · ${ROLE_LABELS[role]}` : label}
            </span>
            <span className="hidden text-[15px] font-extrabold md:block">Fleet Ops</span>
            <span className="truncate text-[19px] font-extrabold leading-tight md:text-xs md:font-normal md:text-muted">
              {organizationName}
            </span>
          </div>
          {modules.length > 1 && role !== "crew" ? (
            <ModuleSwitch modules={modules} current={openModule} pathname={pathname} className="ml-2 hidden md:flex" />
          ) : null}
        </div>

        <nav aria-label="Main" className="hidden flex-1 flex-wrap justify-center gap-1 md:flex">
          {links.filter((link) => !link.settings).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(pathname, link.href) ? "page" : undefined}
              className={`flex min-h-10 items-center rounded-full px-4 text-sm ${
                isActive(pathname, link.href)
                  ? "bg-brand-soft font-bold text-brand-dark"
                  : "font-medium text-ink hover:bg-canvas"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {canAdd ? (
            <Link
              href={addEntryHref(role, openModule)}
              className="hidden min-h-10 items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-bold text-white md:flex"
            >
              <PlusIcon className="h-4 w-4" />
              Add cash entry
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
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-brand-pale text-[13px] font-bold text-brand-dark"
            >
              {initials(label)}
            </button>
            {accountOpen ? (
              <div
                id={accountId}
                role="menu"
                className="absolute right-0 top-full z-30 mt-2 w-60 overflow-hidden rounded-3xl bg-white p-2 shadow-[0_8px_24px_rgba(26,27,46,0.14)]"
              >
                <div className="px-3 pb-2 pt-1">
                  <p className="truncate text-sm font-bold">{label}</p>
                  {email && email !== label ? (
                    <p className="truncate text-xs text-muted">{email}</p>
                  ) : null}
                </div>
                {links
                  .filter((link) => link.settings)
                  .map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      role="menuitem"
                      className="flex min-h-11 items-center rounded-2xl px-3 text-sm font-semibold hover:bg-canvas"
                    >
                      {link.label}
                    </Link>
                  ))}
                {isSuperAdmin ? (
                  <Link
                    href="/admin/companies"
                    role="menuitem"
                    className="flex min-h-11 items-center rounded-2xl px-3 text-sm font-semibold hover:bg-canvas"
                  >
                    Fleet Ops admin
                  </Link>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void onSignOut()}
                  className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm font-semibold hover:bg-canvas"
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {modules.length > 1 && role !== "crew" ? (
        <div className="mx-auto w-full max-w-6xl px-4 pb-2 md:hidden">
          <ModuleSwitch modules={modules} current={openModule} pathname={pathname} className="flex" />
        </div>
      ) : null}
    </header>
  );
}

const MODULE_ACCENT: Record<ModuleId, string> = {
  town: "bg-brand text-white",
  omni: "bg-teal-700 text-white",
  tour: "bg-amber-600 text-white",
};

/** Town | Omni | Tour. Each opens that module's home. */
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
    <nav aria-label="Modules" className={`gap-1 rounded-full bg-white p-1 md:bg-canvas ${className}`}>
      {modules.map((item) => {
        const active = inModule && item === current;
        return (
          <Link
            key={item}
            href={moduleHref(item)}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-9 grow items-center justify-center rounded-full px-4 text-sm font-bold ${
              active ? MODULE_ACCENT[item] : "text-muted hover:text-ink"
            }`}
          >
            {MODULE_LABELS[item]}
          </Link>
        );
      })}
    </nav>
  );
}

export function PlusIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
