"use client";

import Link from "next/link";
import { moduleHref, type ModuleId } from "@domain/modules/modules";
import { dueText } from "@domain/renewals/catalog";
import { useAlerts } from "@/components/alerts/AlertsProvider";
import { emiHref } from "@/components/alerts/sources";
import { Card } from "@/components/ui/primitives";

type Row = { key: string; href: string; title: string; meta: string; due: string; urgent: boolean };

const MAX_ROWS = 6;

/** Documents, mileage and EMIs that need a look, in one list, the most urgent first. */
export function NeedsAttention({ module }: { module: ModuleId }) {
  const { documents, mileage, emis } = useAlerts();
  const rows: Row[] = [
    ...emis.map((line, index) => ({
      key: `emi-${index}`,
      href: emiHref(module),
      title: line.text,
      meta: "Loan EMI",
      due: line.kind === "overdue" ? "Overdue" : "Due soon",
      urgent: line.kind === "overdue",
    })),
    ...documents.map((item) => ({
      key: `doc-${item.id}`,
      href: moduleHref(module, "renewals"),
      title: `${item.owner} · ${item.label}`,
      meta: "Document",
      due: dueText(item.days),
      urgent: item.days <= 7,
    })),
    ...mileage.map((view) => ({
      key: `km-${view.bus.id}`,
      href: moduleHref(module, "mileage"),
      title: view.bus.registrationNumber,
      meta: "Mileage",
      due: view.reason,
      urgent: view.status === "alert",
    })),
  ].sort((left, right) => Number(right.urgent) - Number(left.urgent));
  const shown = rows.slice(0, MAX_ROWS);

  return (
    <Card
      title="Needs attention"
      action={
        <Link href={moduleHref(module, "health")} className="text-sm font-medium text-brand hover:text-brand-dark">
          Fleet health
        </Link>
      }
    >
      {shown.length === 0 ? (
        <p className="text-sm text-muted">Nothing needs attention. Documents, mileage and EMIs are all fine.</p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((row) => (
            <li key={row.key}>
              <Link href={row.href} className="flex items-start gap-3 py-3">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${row.urgent ? "bg-money-out" : "bg-warn-ink"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{row.title}</span>
                  <span className="block text-xs text-muted">{row.meta}</span>
                </span>
                <span className={`max-w-[45%] shrink-0 truncate text-xs font-semibold ${row.urgent ? "text-money-out" : "text-warn-ink"}`}>
                  {row.due}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rows.length > shown.length ? (
        <Link href={moduleHref(module, "health")} className="text-xs font-medium text-brand">
          and {rows.length - shown.length} more in Fleet health
        </Link>
      ) : null}
    </Card>
  );
}
