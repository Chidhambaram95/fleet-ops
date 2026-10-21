import { redirectToModuleScreen } from "@/app/(app)/moduleAccess";

/** Old link: opens renewals in the person's module. */
export default async function OldRenewalsPage() {
  return redirectToModuleScreen("renewals");
}
