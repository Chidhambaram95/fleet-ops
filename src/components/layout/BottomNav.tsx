"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PlusIcon } from "./AppHeader";
import { isActive } from "./navLinks";

/** Phone-only tabs: Home, a big + for a new entry, and More. */
export function BottomNav({ canAdd }: { canAdd: boolean }) {
  const pathname = usePathname();
  const homeActive = isActive(pathname, "/");
  const moreActive = !homeActive;
  const tab = (active: boolean) =>
    `flex flex-col items-center justify-center gap-0.5 text-[11px] ${
      active ? "font-bold text-brand" : "font-medium text-muted"
    }`;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 items-center rounded-t-3xl bg-white px-2 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-2px_12px_rgba(26,27,46,0.08)] md:hidden"
    >
      <Link href="/" aria-current={homeActive ? "page" : undefined} className={tab(homeActive)}>
        <HomeIcon />
        Home
      </Link>
      {canAdd ? (
        <Link
          href="/?add=income"
          aria-label="Add entry"
          className="-mt-7 flex h-14 w-14 items-center justify-center justify-self-center rounded-full bg-brand text-white shadow-[0_6px_16px_rgba(58,63,184,0.35)]"
        >
          <PlusIcon className="h-7 w-7" />
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      <Link href="/more" aria-current={moreActive ? "page" : undefined} className={tab(moreActive)}>
        <MenuIcon />
        More
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

function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
