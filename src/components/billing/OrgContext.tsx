"use client";

import { createContext, useContext } from "react";

export type OrgInfo = {
  name: string;
  /** Digits for wa.me links; empty until the admin sets it in company settings. */
  whatsappNumber: string;
  /** Fifteen days past the due date: entries can be read but not changed. */
  viewOnly: boolean;
};

const OrgContext = createContext<OrgInfo>({
  name: "Fleet",
  whatsappNumber: "",
  viewOnly: false,
});

export function OrgProvider({
  value,
  children,
}: {
  value: OrgInfo;
  children: React.ReactNode;
}) {
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  return useContext(OrgContext);
}
