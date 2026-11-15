"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { moduleHref } from "@domain/modules/modules";
import { NavIcon } from "@/components/ui/icons";
import { useDismiss } from "@/components/ui/useDismiss";
import { useAlerts } from "./AlertsProvider";
import { emiHref } from "./sources";

/** Top bar bell: documents, mileage and EMIs that need a look, each linking to where it is handled. */
export function AlertsBell() {
  const { module, documents, expired, mileage, emis, count } = useAlerts();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  useEffect(() => setOpen(false), [pathname]);
  if (!module) return null;

  const rows = [
    {
      href: moduleHref(module, "renewals"),
      title: `Documents · ${documents.length}`,
      detail: documents.length
        ? expired
          ? `${expired} expired, ${documents.length - expired} due within 30 days`
          : `${documents.length} due within 30 days`
        : "Nothing due in 30 days",
      urgent: expired > 0,
    },
    {
      href: moduleHref(module, "mileage"),
      title: `Mileage · ${mileage.length}`,
      detail: mileage.length
        ? `${mileage.length} ${mileage.length === 1 ? "bus needs" : "buses need"} a look`
        : "All buses look fine",
      urgent: false,
    },
    {
      href: emiHref(module),
      title: `EMIs · ${emis.length}`,
      detail: emis[0]?.text ?? "Nothing to fund or confirm",
      urgent: emis.some((line) => line.kind === "overdue"),
    },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={count ? `Alerts: ${count} need a look` : "Alerts"}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
      >
        <NavIcon name="bell" className="h-5 w-5" />
        {count ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-money-out px-1 text-xs font-semibold text-white">
            {count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-0.5 rounded-xl border border-line bg-surface p-2 shadow-lg">
          {rows.map((row) => (
            <Link key={row.title} href={row.href} className="flex flex-col gap-0.5 rounded-md px-3 py-2 hover:bg-subtle">
              <span className="text-sm font-semibold text-ink">{row.title}</span>
              <span className={`truncate text-xs ${row.urgent ? "font-semibold text-money-out" : "text-muted"}`}>
                {row.detail}
              </span>
            </Link>
          ))}
          <Link
            href={moduleHref(module, "health")}
            className="mt-1 rounded-md border-t border-line px-3 pb-1 pt-2.5 text-sm font-medium text-brand hover:text-brand-dark"
          >
            Open Fleet health
          </Link>
        </div>
      ) : null}
    </div>
  );
}
