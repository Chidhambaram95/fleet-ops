import { redirectToModuleScreen } from "@/app/(app)/moduleAccess";

/** Old link: opens trips in the person's module. */
export default async function OldNewTripPage() {
  return redirectToModuleScreen("trips", "/new");
}
