import { redirectToModuleScreen } from "@/app/(app)/moduleAccess";

/** Old link: opens reports in the person's module. */
export default async function OldReportsPage() {
  return redirectToModuleScreen("reports");
}
