"use client";

import { createContext, useContext } from "react";
import type { ModuleId } from "@domain/modules/modules";
import { canManage, type UserRole } from "@domain/rbac/roles";

export type OrgInfo = {
  name: string;
  /** Digits for wa.me links; empty until the admin sets it in company settings. */
  whatsappNumber: string;
  /** Fifteen days past the due date: entries can be read but not changed. */
  viewOnly: boolean;
};

/** Who is signed in and what they may open. Worked out once on the server, in the app layout. */
export type SessionFacts = {
  organizationId: string;
  userId: string;
  role: UserRole | null;
  /** Modules this person may open (empty for crew). */
  modules: ModuleId[];
  /** The module used last, or the first one. */
  defaultModule: ModuleId | null;
  /** Company costs and the all-buses report are open to this person. */
  companyArea: boolean;
  /** Crew only: the bus they are assigned to, else an empty string. */
  assignedBusId: string;
};

export type SessionInfo = OrgInfo & SessionFacts;

const DEFAULT_SESSION: SessionInfo = {
  name: "Fleet",
  whatsappNumber: "",
  viewOnly: false,
  organizationId: "",
  userId: "",
  role: null,
  modules: [],
  defaultModule: null,
  companyArea: false,
  assignedBusId: "",
};

const OrgContext = createContext<SessionInfo>(DEFAULT_SESSION);

export function OrgProvider({
  value,
  children,
}: {
  value: Partial<SessionInfo> & OrgInfo;
  children: React.ReactNode;
}) {
  return <OrgContext.Provider value={{ ...DEFAULT_SESSION, ...value }}>{children}</OrgContext.Provider>;
}

/** The company's name, WhatsApp number and view-only flag. */
export function useOrg(): SessionInfo {
  return useContext(OrgContext);
}

/** The signed-in person: organisation, user, role, modules. Replaces looking the membership up again in the browser. */
export function useSession(): SessionInfo {
  return useContext(OrgContext);
}

/** Admins and managers. */
export function useCanManage() {
  return canManage(useContext(OrgContext).role);
}
