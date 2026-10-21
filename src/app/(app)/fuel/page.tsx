import { redirectToModuleScreen } from "@/app/(app)/moduleAccess";

/** Old link: opens fuel in the person's module. */
export default async function OldFuelPage() {
  return redirectToModuleScreen("fuel");
}
