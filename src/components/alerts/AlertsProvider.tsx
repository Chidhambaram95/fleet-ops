"use client";

import { createContext, useContext, useMemo } from "react";
import { usePathname } from "next/navigation";
import { currentModule } from "@/components/layout/navLinks";
import { useSession } from "@/components/billing/OrgContext";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { canManage } from "@domain/rbac/roles";
import type { ModuleId } from "@domain/modules/modules";
import type { BusMileageView } from "@domain/mileage/mileage";
import {
  useEmiAlerts,
  useMileageProblems,
  useRenewalAlerts,
  type EmiAlertLine,
  type RenewalAlert,
} from "./sources";

export type Alerts = {
  module: ModuleId | null;
  documents: RenewalAlert[];
  /** Documents already past their date. */
  expired: number;
  mileage: BusMileageView[];
  emis: EmiAlertLine[];
  /** Everything that needs a look: documents, mileage buses and EMIs. */
  count: number;
};

const EMPTY: Alerts = { module: null, documents: [], expired: 0, mileage: [], emis: [], count: 0 };

const AlertsContext = createContext<Alerts>(EMPTY);

/**
 * One place that asks for the open alerts of the module being looked at, so the
 * bell, the menu badge and the Overview share them instead of each asking again.
 * The questions are the same ones the separate home cards used to ask.
 */
export function AlertsProvider({ children }: { children: React.ReactNode }) {
  const { organizationId, role, modules, defaultModule } = useSession();
  const pathname = usePathname();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const openModule = canManage(role) ? currentModule(pathname, modules, defaultModule) : null;
  // Check again on leaving the pages where alerts get cleared.
  const emis = useEmiAlerts(supabase, organizationId, openModule, pathname);
  const mileage = useMileageProblems(supabase, organizationId, openModule, pathname.endsWith("/mileage") ? "on" : "off");
  const documents = useRenewalAlerts(supabase, organizationId, openModule, pathname.includes("/renewals") ? "on" : "off");
  const value = useMemo<Alerts>(
    () => ({
      module: openModule,
      documents,
      expired: documents.filter((item) => item.days < 0).length,
      mileage,
      emis,
      count: documents.length + mileage.length + emis.length,
    }),
    [openModule, documents, mileage, emis],
  );
  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts(): Alerts {
  return useContext(AlertsContext);
}
