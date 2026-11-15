"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { moduleHref, type ModuleId } from "@domain/modules/modules";

type HealthTab = "status" | "documents" | "mileage" | "loans";

function Tabs({ module }: { module: ModuleId }) {
  const pathname = usePathname();
  const section = useSearchParams().get("section");
  const active: HealthTab | null = pathname.endsWith("/mileage")
    ? "mileage"
    : pathname.includes("/renewals")
      ? section === "loans"
        ? "loans"
        : "documents"
      : pathname.endsWith("/health")
        ? "status"
        : null;
  const tabs: { id: HealthTab; label: string; href: string }[] = [
    { id: "status", label: "Status", href: moduleHref(module, "health") },
    { id: "documents", label: "Documents", href: moduleHref(module, "renewals") },
    { id: "mileage", label: "Mileage", href: moduleHref(module, "mileage") },
    { id: "loans", label: "Loans & EMIs", href: `${moduleHref(module, "renewals")}?section=loans` },
  ];
  return (
    <nav aria-label="Fleet health" className="flex gap-6 overflow-x-auto border-b border-line">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={active === tab.id ? "page" : undefined}
          className={`-mb-px inline-flex h-10 shrink-0 items-center border-b-2 text-sm ${
            active === tab.id
              ? "border-brand font-semibold text-ink"
              : "border-transparent font-medium text-muted hover:text-ink"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** Links the Fleet health pages together: status, documents, mileage and loans. */
export function HealthTabs({ module }: { module: ModuleId }) {
  return (
    <Suspense fallback={<div className="h-10 border-b border-line" />}>
      <Tabs module={module} />
    </Suspense>
  );
}
