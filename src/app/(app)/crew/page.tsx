import { redirectToModuleScreen } from "@/app/(app)/moduleAccess";

/** Old link: opens crew in the person's module. */
export default async function OldCrewPage() {
  return redirectToModuleScreen("crew");
}
