import { redirectToModuleScreen } from "@/app/(app)/moduleAccess";

/** Old link: opens buses in the person's module. */
export default async function OldFleetPage() {
  return redirectToModuleScreen("buses");
}
