"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "@data/auth/email";
import type { UserRole } from "@domain/rbac/roles";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function AppHeader({
  organizationName,
  email,
  displayName,
  role,
}: {
  organizationName: string;
  email: string;
  displayName: string;
  role: UserRole | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const manageId = useId();
  const accountId = useId();
  const [manageOpen, setManageOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const label = displayName || email || "Signed in";

  useEffect(() => {
    setManageOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!headerRef.current?.contains(event.target as Node)) {
        setManageOpen(false);
        setAccountOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setManageOpen(false);
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
    <header ref={headerRef} className="sticky top-0 z-40 border-b border-stone-200 bg-white">
      <div className="relative mx-auto grid h-14 max-w-md grid-cols-[1fr_auto_1fr] items-center gap-2 px-3">
        <div className="flex items-center gap-1">
          <Link
            href="/"
            aria-label="Home"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-stone-800 hover:bg-stone-100"
          >
            <HomeIcon />
          </Link>
          {role === "admin" ? (
            <div className="relative">
              <button
                type="button"
                aria-label="Manage"
                aria-haspopup="menu"
                aria-expanded={manageOpen}
                aria-controls={manageId}
                onClick={() => {
                  setAccountOpen(false);
                  setManageOpen((open) => !open);
                }}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-stone-800 hover:bg-stone-100"
              >
                <MenuIcon />
              </button>
              {manageOpen ? (
                <div
                  id={manageId}
                  role="menu"
                  className="absolute left-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg"
                >
                  <Link
                    href="/fleet"
                    role="menuitem"
                    className="flex items-center px-3 text-sm font-medium text-stone-800 hover:bg-stone-50"
                  >
                    Manage Fleet
                  </Link>
                  <Link
                    href="/settings/team"
                    role="menuitem"
                    className="flex items-center px-3 text-sm font-medium text-stone-800 hover:bg-stone-50"
                  >
                    Manage Team
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <p className="max-w-[10.5rem] truncate text-center text-sm font-semibold tracking-tight text-stone-900">
          {organizationName}
        </p>

        <div className="flex justify-end">
          <div className="group relative">
            <button
              type="button"
              aria-label={label}
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              aria-controls={accountId}
              onClick={() => {
                setManageOpen(false);
                setAccountOpen((open) => !open);
              }}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-orange-700 text-xs font-semibold text-white"
            >
              {initials(label)}
            </button>
            {accountOpen ? (
              <div
                id={accountId}
                role="menu"
                className="absolute right-0 top-full z-30 mt-1 w-36 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void onSignOut()}
                  className="flex w-full items-center px-3 text-left text-sm font-medium text-stone-800 hover:bg-stone-50"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <span
                role="tooltip"
                className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden max-w-[14rem] truncate rounded-lg bg-stone-900 px-2 py-1 text-xs font-medium text-white group-hover:block group-focus-within:block"
              >
                {email && email !== label ? `${label} · ${email}` : label}
              </span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function initials(value: string) {
  const parts = value
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function HomeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}
